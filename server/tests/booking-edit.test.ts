import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh, toIsoDate } from "../src/lib/dates.js";

const app = makeApp({ bookingLimit: 100_000, codeCheckLimit: 100_000 });

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday(); // 950
const THU = addDays(SUN, 4); // 1,200
const SAT = addDays(SUN, 6); // 1,200 (weekend)

type Agent = Awaited<ReturnType<typeof signedIn>>["agent"];
let n = 0;
async function manual(agent: Agent, extra: Record<string, unknown> = {}) {
  const full = await fullResource();
  const r = await agent.post("/api/admin/bookings").send({
    resourceIds: [full.id], startDate: SUN, nights: 1, name: "ضيف يدوي", phone: `0580000${String(++n).padStart(3, "0")}`, channel: "MANUAL", securityDeposit: 0, ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string };
}
const days = async (id: string) => (await db.bookingItem.findMany({ where: { bookingId: id }, orderBy: { date: "asc" } })).map((i) => toIsoDate(i.date));
const lockDays = async (id: string) => [...new Set((await db.bookingLock.findMany({ where: { bookingId: id } })).map((l) => toIsoDate(l.date)))].sort();
const edit = (agent: Agent, id: string, body: Record<string, unknown>) => agent.post(`/api/admin/bookings/${id}/edit`).send(body);

beforeEach(async () => {
  await resetDb();
  n = 0;
});
afterAll(() => db.$disconnect());

describe("separate days in one manual booking", () => {
  it("books only the chosen days, priced per day, and leaves the days between free", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const q = (await agent.post("/api/admin/bookings/quote").send({ resourceIds: [full.id], startDate: SUN, nights: 2, dates: [THU, SUN] })).body;
    expect(q).toMatchObject({ available: true, total: 2150 });
    const b = await manual(agent, { dates: [THU, SUN], nights: 2 });
    expect(await days(b.id)).toEqual([SUN, THU]);
    expect(await lockDays(b.id)).toEqual([SUN, THU]);
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(toIsoDate(row.startDate)).toBe(SUN);
    expect(toIsoDate(row.endDate)).toBe(addDays(THU, 1));
    expect(row.totalAmount.toFixed(2)).toBe("2150.00");
    // Monday (between the two days) is still free for others.
    const mon = (await agent.post("/api/admin/bookings/quote").send({ resourceIds: [full.id], startDate: addDays(SUN, 1), nights: 1 })).body;
    expect(mon.available).toBe(true);
    // The list counts 2 booked days, not the 5-day span; the contract lists them.
    const list = (await agent.get("/api/admin/bookings")).body.items;
    expect(list[0].days).toBe(2);
    const contract = JSON.stringify((await agent.get(`/api/admin/bookings/${b.id}/contract`)).body.blocks);
    // The calendar marks only the booked days, not the 5-day span.
    const cal = (await agent.get(`/api/admin/calendar?from=${SUN}&to=${addDays(SUN, 7)}`)).body.bookings;
    expect(cal[0].days).toEqual([SUN, THU]);
    expect(contract).toContain("الأيام المستأجرة");
    expect(contract).toContain("اليوم 1");
    expect(contract).toContain("اليوم 2");
    expect(contract).not.toContain('"الدخول"'); // no single check-in → check-out period
  });

  it("refuses a separate day that is already taken", async () => {
    const { agent } = await signedIn(app);
    await manual(agent, { startDate: THU });
    const full = await fullResource();
    const r = await agent.post("/api/admin/bookings").send({ resourceIds: [full.id], startDate: SUN, nights: 2, dates: [SUN, THU], name: "ضيف آخر", phone: "0589999999", channel: "MANUAL" });
    expect(r.status).toBe(409);
    expect(await db.booking.count()).toBe(1);
  });

  it("the website still books consecutive days only", async () => {
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({
      resourceIds: [full.id], startDate: SUN, nights: 1, dates: [SUN, THU], name: "ضيف موقع تجريبي", nationalId: "1023456789", phone: "0561111111", acceptTerms: true,
    });
    expect(r.status).toBe(201);
    expect(await days((await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } })).id)).toEqual([SUN]);
  });
});

describe("editing a booking (confirmed included)", () => {
  async function confirmed(agent: Agent) {
    const b = await manual(agent, { initialPayment: { amount: 950, method: "CASH" } });
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    return b;
  }

  it("changes the price of a confirmed booking with a manual discount; payments stay as they are", async () => {
    const { agent } = await signedIn(app);
    const b = await confirmed(agent);
    const r = await edit(agent, b.id, { manualDiscount: { type: "FINAL_PRICE", value: 900 } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "CONFIRMED", totalAmount: "900", discountAmount: "50", manualDiscountType: "FINAL_PRICE", overpaid: "50.00" });
    expect(await db.payment.count({ where: { bookingId: b.id } })).toBe(1);
    // Removing the discount brings back the base price.
    const back = await edit(agent, b.id, { manualDiscount: null });
    expect(back.body).toMatchObject({ totalAmount: "950", discountAmount: "0", manualDiscountType: null, overpaid: null });
    const log = await db.auditLog.findMany({ where: { entityId: b.id, action: "booking.edit" } });
    expect(log).toHaveLength(2);
  });

  it("adds a separate day: new price, locks follow, the remaining balance grows", async () => {
    const { agent } = await signedIn(app);
    const b = await confirmed(agent);
    const r = await edit(agent, b.id, { dates: [SUN, THU] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totalAmount).toBe("2150");
    expect(await days(b.id)).toEqual([SUN, THU]);
    expect(await lockDays(b.id)).toEqual([SUN, THU]);
    const d = (await agent.get(`/api/admin/bookings/${b.id}`)).body;
    expect(d.status).toBe("CONFIRMED");
    expect(Number(d.totalAmount) - Number(d.paid)).toBe(1200);
  });

  it("moves to other days, freeing the old ones; keeps a manual discount applied to the new price", async () => {
    const { agent } = await signedIn(app);
    const b = await manual(agent, { manualDiscount: { type: "PERCENT", value: 10 } });
    const r = await edit(agent, b.id, { dates: [THU, addDays(THU, 1)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await lockDays(b.id)).toEqual([THU, addDays(THU, 1)]);
    const base = 1200 + 1200; // Thursday + Friday
    expect(Number(r.body.discountAmount)).toBe(base * 0.1);
    expect(Number(r.body.totalAmount)).toBe(base * 0.9);
    // Sunday is free again.
    await manual(agent, { startDate: SUN });
  });

  it("refuses days taken by another booking and changes nothing", async () => {
    const { agent } = await signedIn(app);
    const b = await manual(agent);
    await manual(agent, { startDate: SAT });
    const before = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    const r = await edit(agent, b.id, { dates: [SUN, SAT], manualDiscount: { type: "FIXED", value: 100 } });
    expect(r.status).toBe(409);
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.totalAmount.toFixed(2)).toBe(before.totalAmount.toFixed(2));
    expect(await days(b.id)).toEqual([SUN]);
    expect(await lockDays(b.id)).toEqual([SUN]);
  });

  it("can change the booking type, deposit, plan and details; the deposit plan follows the new total", async () => {
    const { agent } = await signedIn(app);
    const b = await manual(agent);
    const r = await edit(agent, b.id, { securityDeposit: 300, paymentPlan: "DEPOSIT", guestCount: 12, adminNotes: "عدّل الموعد", manualDiscount: { type: "FIXED", value: 150 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ depositAmount: "300", paymentPlan: "DEPOSIT", upfrontAmount: "400", guestCount: 12, adminNotes: "عدّل الموعد", totalAmount: "800" });
  });

  it("refuses a discount above the new price and edits of closed bookings", async () => {
    const { agent } = await signedIn(app);
    const b = await manual(agent);
    expect((await edit(agent, b.id, { manualDiscount: { type: "FIXED", value: 2000 } })).status).toBe(400);
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await edit(agent, b.id, { guestCount: 3 })).status).toBe(409);
  });

  it("quoting a change does not count the booking's own days as taken", async () => {
    const { agent } = await signedIn(app);
    const b = await manual(agent);
    const full = await fullResource();
    const plain = (await agent.post("/api/admin/bookings/quote").send({ resourceIds: [full.id], startDate: SUN, nights: 1, dates: [SUN, THU] })).body;
    expect(plain.available).toBe(false);
    const forEdit = (await agent.post("/api/admin/bookings/quote").send({ resourceIds: [full.id], startDate: SUN, nights: 1, dates: [SUN, THU], bookingId: b.id })).body;
    expect(forEdit).toMatchObject({ available: true, total: 2150 });
  });
});

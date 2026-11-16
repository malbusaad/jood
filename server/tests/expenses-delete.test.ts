import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh, toIsoDate } from "../src/lib/dates.js";
import { categorize, ensureRecurringExpenses } from "../src/services/expenses.js";

const app = makeApp({ bookingLimit: 100_000 });

beforeEach(async () => {
  await resetDb();
});
afterAll(() => db.$disconnect());

describe("automatic expense categories", () => {
  it("picks the category from the description, ignoring letter variants", () => {
    expect(categorize("فاتورة الكهرباء")).toBe("كهرباء ومياه");
    expect(categorize("صيانة المكيف")).toBe("صيانة");
    expect(categorize("فني مكيفات")).toBe("صيانة");
    expect(categorize("منظفات ومعطرات")).toBe("نظافة");
    expect(categorize("راتب الحارس")).toBe("رواتب");
    expect(categorize("إعلان سناب")).toBe("تسويق");
    expect(categorize("اشتراك النت")).toBe("رسوم واشتراكات");
    expect(categorize("شراء مفارش")).toBe("مشتريات");
    expect(categorize("نتيجة")).toBe("أخرى"); // «نت» only as a whole word
    expect(categorize("شيء آخر")).toBe("أخرى");
  });

  it("uses it when the category is left empty; a chosen category always wins", async () => {
    const { agent } = await signedIn(app);
    const a = await agent.post("/api/admin/expenses").send({ title: "فاتورة المياه", date: "2026-05-10", amount: 90 });
    expect(a.status).toBe(201);
    expect(a.body.category).toBe("كهرباء ومياه");
    const b = await agent.post("/api/admin/expenses").send({ title: "فاتورة المياه", category: "أخرى", date: "2026-05-11", amount: 90 });
    expect(b.body.category).toBe("أخرى");
  });

  it("re-categorizes «أخرى» expenses in one go, and reports totals by category", async () => {
    const { agent } = await signedIn(app);
    for (const [title, amount] of [["تنظيف الاستراحة", 200], ["سباك", 150], ["شيء", 10]] as const) {
      await db.expense.create({ data: { title, category: "أخرى", date: new Date("2026-05-10"), amount } });
    }
    const before = (await agent.get("/api/admin/expenses")).body;
    expect(before.canAutoCategorize).toBe(2);
    expect(before.rules.length).toBeGreaterThan(5);
    expect((await agent.post("/api/admin/expenses/auto-categorize").send({})).body).toEqual({ updated: 2 });
    const after = (await agent.get("/api/admin/expenses?from=2026-05-01&to=2026-05-31")).body;
    expect(after.byCategory).toEqual({ نظافة: 200, صيانة: 150, أخرى: 10 });
    expect(after.canAutoCategorize).toBe(0);
  });
});

describe("recurring expenses («مصروف دائم»)", () => {
  it("adds the expense every month on the same day until stopped; amount changes carry forward", async () => {
    const { agent } = await signedIn(app);
    const r = await agent.post("/api/admin/expenses").send({ title: "راتب الحارس", date: "2026-01-31", amount: 1500, recurring: true });
    expect(r.body).toMatchObject({ recurring: true, category: "رواتب" });
    expect(await ensureRecurringExpenses(db, "2026-04-15")).toBe(2); // 28 Feb, 31 Mar (not April yet)
    expect(await ensureRecurringExpenses(db, "2026-04-15")).toBe(0); // never twice
    let all = await db.expense.findMany({ orderBy: { date: "asc" } });
    expect(all.map((e) => toIsoDate(e.date))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(new Set(all.map((e) => e.seriesId))).toEqual(new Set([r.body.id]));
    // A raise on the latest entry carries forward.
    const last = all.at(-1)!;
    await agent.put(`/api/admin/expenses/${last.id}`).send({ title: "راتب الحارس", date: "2026-03-31", amount: 1700, recurring: true }).expect(200);
    expect(await ensureRecurringExpenses(db, "2026-04-30")).toBe(1);
    all = await db.expense.findMany({ orderBy: { date: "asc" } });
    expect(Number(all.at(-1)!.amount)).toBe(1700);
    // Turning «دائم» off on the latest entry stops the series.
    await agent.put(`/api/admin/expenses/${all.at(-1)!.id}`).send({ title: "راتب الحارس", date: "2026-04-30", amount: 1700, recurring: false }).expect(200);
    expect(await ensureRecurringExpenses(db, "2026-08-30")).toBe(0);
    // Recurring vs one-off filter and total.
    await agent.post("/api/admin/expenses").send({ title: "سباك", date: "2026-03-05", amount: 100 }).expect(201);
    const march = (await agent.get("/api/admin/expenses?from=2026-03-01&to=2026-03-31")).body;
    expect(march).toMatchObject({ periodTotal: 1800, recurringTotal: 1700 });
    expect((await agent.get("/api/admin/expenses?from=2026-03-01&to=2026-03-31&kind=once")).body.items).toHaveLength(1);
  });
});

describe("deleting a closed booking permanently", () => {
  function nextSunday() {
    let d = addDays(todayInRiyadh(), 7);
    while (dayOfWeek(d) !== 0) d = addDays(d, 1);
    return d;
  }
  async function booking(agent: Awaited<ReturnType<typeof signedIn>>["agent"], phone = "0570001111") {
    const full = await fullResource();
    const r = await agent.post("/api/admin/bookings").send({ resourceIds: [full.id], startDate: nextSunday(), nights: 1, name: "متعب تجربة الحذف", phone, channel: "MANUAL", initialPayment: { amount: 100, method: "CASH" } });
    expect(r.status).toBe(201);
    return r.body as { id: string; reference: string; guestId: string };
  }

  it("refuses active bookings, a wrong number and staff; deletes a cancelled one with its records, keeping an audit entry", async () => {
    const { agent } = await signedIn(app);
    const b = await booking(agent);
    expect((await agent.delete(`/api/admin/bookings/${b.id}`).send({ reference: b.reference })).status).toBe(409);
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED", reason: "تجربة" }).expect(200);
    expect((await agent.delete(`/api/admin/bookings/${b.id}`).send({ reference: "JD-999999" })).status).toBe(400);
    expect((await (await signedIn(app, "STAFF")).agent.delete(`/api/admin/bookings/${b.id}`).send({ reference: b.reference })).status).toBe(403);

    const r = await agent.delete(`/api/admin/bookings/${b.id}`).send({ reference: b.reference.toLowerCase() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ reference: b.reference, guestDeleted: false });
    expect(await db.booking.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(await db.guest.count()).toBe(1); // the customer stays unless asked
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "booking.delete" } });
    expect(log.details).toMatchObject({ reference: b.reference, guest: "متعب تجربة الحذف", payments: ["100.00 BOOKING"] });
  });

  it("removes the customer too when asked and they have no other booking", async () => {
    const { agent } = await signedIn(app);
    const b = await booking(agent);
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await agent.delete(`/api/admin/bookings/${b.id}`).send({ reference: b.reference, deleteGuest: true })).body.guestDeleted).toBe(true);
    expect(await db.guest.count()).toBe(0);
  });
});

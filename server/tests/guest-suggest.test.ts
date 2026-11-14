import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, fromIsoDate, todayInRiyadh } from "../src/lib/dates.js";
import { makeSecretBox } from "../src/lib/secretBox.js";

const box = makeSecretBox("test-secret-test-secret-test-secret-1", "door-codes");
const app = makeApp({ secretBox: box, bookingLimit: 1000 });
function sunday(weeks = 1) {
  let d = addDays(todayInRiyadh(), 7 * weeks);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

/** Existing customers as the site already stores them (website and imported records). */
async function customers() {
  const sara = await db.guest.create({ data: { name: "سارة محمد القحطاني", phone: "966501112222", email: "s@example.com", notes: "عميلة دائمة", nationalIdEnc: box.seal("1023456789"), nationalIdLast4: "6789" } });
  const ahmad = await db.guest.create({ data: { name: "أحمد عبدالله الدوسري", phone: "966553334444" } });
  const fatima = await db.guest.create({ data: { name: "فاطمة سعد", phone: null, notes: "من السجل السابق — بدون رقم جوال" } });
  const full = await fullResource();
  // An older booking for Sara, so she is ranked as a known customer.
  await db.booking.create({
    data: { reference: "OLD-1", guestId: sara.id, status: "COMPLETED", channel: "IMPORTED", startDate: fromIsoDate("2026-05-01"), endDate: fromIsoDate("2026-05-02"), totalAmount: 900, upfrontAmount: 900, legacyPayment: true, priceBreakdown: [], items: { create: [{ resourceId: full.id, date: fromIsoDate("2026-05-01"), price: 900 }] } },
  });
  return { sara, ahmad, fatima, full };
}

describe("customer suggestions while typing", () => {
  it("finds customers from any part of the name, from the first letter, ignoring Arabic letter variants", async () => {
    const { agent } = await signedIn(app);
    await customers();
    const names = async (q: string) => (await agent.get(`/api/admin/guests/suggest?q=${encodeURIComponent(q)}`)).body.map((g: { name: string }) => g.name);
    expect(await names("س")).toEqual(expect.arrayContaining(["سارة محمد القحطاني", "أحمد عبدالله الدوسري", "فاطمة سعد"]));
    expect(await names("القحط")).toEqual(["سارة محمد القحطاني"]);
    expect(await names("ساره")).toEqual(["سارة محمد القحطاني"]); // ه / ة
    expect(await names("احمد")).toEqual(["أحمد عبدالله الدوسري"]); // ا / أ
    expect(await names("سارة القحطاني")).toEqual(["سارة محمد القحطاني"]); // words in any position
    expect(await names("فاطمه")).toEqual(["فاطمة سعد"]);
    expect(await names("0553")).toEqual(["أحمد عبدالله الدوسري"]); // part of the phone
    expect(await names("%")).toEqual([]); // no wildcard tricks
  });

  it("returns the saved details (ID only masked), most recent customer first", async () => {
    const { agent } = await signedIn(app);
    const { sara } = await customers();
    const [first] = (await agent.get("/api/admin/guests/suggest?q=س")).body;
    expect(first).toMatchObject({ id: sara.id, name: "سارة محمد القحطاني", phone: "966501112222", email: "s@example.com", notes: "عميلة دائمة", nationalIdMasked: "••••••6789", bookingCount: 1 });
    expect(first.nationalId).toBeNull();
    expect(JSON.stringify(first)).not.toContain("1023456789");
    expect((await request(app).get("/api/admin/guests/suggest?q=س")).status).toBe(401);
  });
});

describe("manual booking for a returning customer", () => {
  const base = (resourceId: string, start: string) => ({ resourceIds: [resourceId], startDate: start, nights: 1, channel: "MANUAL" });

  it("links the booking to the existing customer record — no new customer, saved name kept", async () => {
    const { agent } = await signedIn(app);
    const { sara, full } = await customers();
    const before = await db.guest.count();
    const r = await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday()), guestId: sara.id });
    expect(r.status).toBe(201);
    expect(r.body.guestId).toBe(sara.id);
    expect(await db.guest.count()).toBe(before);
    expect(await db.booking.count({ where: { guestId: sara.id } })).toBe(2);
    expect((await db.guest.findUniqueOrThrow({ where: { id: sara.id } })).name).toBe("سارة محمد القحطاني");
    // The old booking is untouched.
    expect(await db.booking.findUniqueOrThrow({ where: { reference: "OLD-1" } })).toMatchObject({ status: "COMPLETED", guestId: sara.id });
  });

  it("adds a phone to an old customer who had none, and refuses a phone that belongs to someone else", async () => {
    const { agent } = await signedIn(app);
    const { fatima, full } = await customers();
    expect((await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday()), guestId: fatima.id, phone: "0553334444" })).status).toBe(409);
    const ok = await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday()), guestId: fatima.id, phone: "0567778888" });
    expect(ok.status).toBe(201);
    expect((await db.guest.findUniqueOrThrow({ where: { id: fatima.id } })).phone).toBe("966567778888");
    // Without a phone the booking is still recorded for her.
    expect((await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday(2)), guestId: fatima.id })).status).toBe(201);
  });

  it("new customers work as before; typing an existing phone reuses that record instead of duplicating it", async () => {
    const { agent } = await signedIn(app);
    const { ahmad, full } = await customers();
    const before = await db.guest.count();
    const n = await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday()), name: "خالد ناصر العتيبي", phone: "0599990000" });
    expect(n.status).toBe(201);
    expect(await db.guest.count()).toBe(before + 1);
    const again = await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday(2)), name: "أحمد الدوسري", phone: "0553334444" });
    expect(again.body.guestId).toBe(ahmad.id);
    expect(await db.guest.count()).toBe(before + 1);
    // Neither a chosen customer nor name + phone → refused.
    expect((await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday(3)), name: "اسم فقط" })).status).toBe(400);
    expect((await agent.post("/api/admin/bookings").send({ ...base(full.id, sunday(3)), guestId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { amenityBySlug, db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, fromIsoDate, todayInRiyadh } from "../src/lib/dates.js";
import { expireStaleBookings } from "../src/services/bookings.js";

const app = makeApp({ bookingLimit: 100_000, codeCheckLimit: 100_000 });

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday(); // 950
const THU = addDays(SUN, 4); // 1,200

let n = 0;
function guest(phoneSuffix?: number) {
  const i = phoneSuffix ?? ++n;
  return { name: "ضيف تجربة الخصم", nationalId: "1023456789", phone: `0550000${String(i).padStart(3, "0")}`, acceptTerms: true };
}
function book(resourceIds: string[], startDate: string, nights: number, extra: Record<string, unknown> = {}, g = guest()) {
  return request(app).post("/api/public/bookings").send({ resourceIds, startDate, nights, ...g, ...extra });
}
function quote(resourceIds: string[], startDate: string, nights: number, discountCode?: string) {
  return request(app).post("/api/public/quote").send({ resourceIds, startDate, nights, discountCode });
}
async function makeCode(data: Partial<Parameters<typeof db.discountCode.create>[0]["data"]> = {}) {
  return db.discountCode.create({ data: { code: "JOOD10", type: "PERCENT", value: 10, daysOfWeek: [], ...data } });
}
async function makePart() {
  const a = await amenityBySlug("majlis");
  const part = await db.bookingResource.create({
    data: { slug: "majlis-part", name: "المجلس", kind: "PART", amenities: { create: [{ amenityId: a.id }] } },
  });
  await db.pricingRule.create({ data: { resourceId: part.id, kind: "WEEKDAY", price: 400 } });
  return part;
}

beforeEach(async () => {
  await resetDb();
  n = 0;
});
afterAll(() => db.$disconnect());

describe("discount codes on the website", () => {
  it("applies a percentage to the booking amount only; the deposit stays fixed", async () => {
    const full = await fullResource();
    await makeCode();
    const q = (await quote([full.id], SUN, 2, "jood10")).body; // lower case accepted
    expect(q).toMatchObject({ available: true, subtotal: 1900, discount: { code: "JOOD10", amount: 190 }, discountError: null, total: 1710, deposit: 500, payable: 2210 });

    const r = await book([full.id], SUN, 2, { discountCode: "JOOD10" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ subtotal: 1900, discount: { code: "JOOD10", amount: 190 }, total: 1710, deposit: 500, payable: 2210 });
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference }, include: { redemption: true } });
    expect(b.totalAmount.toFixed(2)).toBe("1710.00");
    expect(b.discountAmount.toFixed(2)).toBe("190.00");
    expect(b.discountCode).toBe("JOOD10");
    expect(b.depositAmount.toFixed(2)).toBe("500.00");
    expect(b.redemption).toMatchObject({ status: "ACTIVE" });
    expect((await db.discountCode.findFirstOrThrow()).usedCount).toBe(1);
  });

  it("caps a fixed discount at the booking amount and accepts Arabic digits", async () => {
    const full = await fullResource();
    await makeCode({ code: "EID100", type: "FIXED", value: 100 });
    expect((await quote([full.id], SUN, 1, "eid١٠٠")).body).toMatchObject({ discount: { amount: 100 }, total: 850 });
    await makeCode({ code: "BIG", type: "FIXED", value: 5000 });
    expect((await quote([full.id], SUN, 1, "BIG")).body).toMatchObject({ discount: { amount: 950 }, total: 0, payable: 500 });
  });

  it("ignores any amount sent by the browser", async () => {
    const full = await fullResource();
    await makeCode();
    const r = await book([full.id], SUN, 1, { discountCode: "JOOD10", total: 1, discountAmount: 949, price: 0 });
    expect(r.body.total).toBe(855);
  });

  it("refuses unknown, switched-off, expired and not-yet-valid codes — the quote still works, the booking is not saved", async () => {
    const full = await fullResource();
    const today = todayInRiyadh();
    await makeCode({ code: "OFF", active: false });
    await makeCode({ code: "OLD", endDate: fromIsoDate(addDays(today, -1)) });
    await makeCode({ code: "SOON", startDate: fromIsoDate(addDays(today, 1)) });
    await makeCode({ code: "TODAY", startDate: fromIsoDate(today), endDate: fromIsoDate(today) });
    const cases: [string, RegExp][] = [
      ["NOPE", /غير صحيح أو غير مفعّل/],
      ["OFF", /غير صحيح أو غير مفعّل/],
      ["OLD", /انتهت صلاحية/],
      ["SOON", /لم تبدأ صلاحيته/],
      ["!!", /غير صحيح/],
    ];
    for (const [code, msg] of cases) {
      const q = (await quote([full.id], SUN, 1, code)).body;
      expect(q).toMatchObject({ available: true, discount: null, total: 950 });
      expect(q.discountError).toMatch(msg);
      const r = await book([full.id], SUN, 1, { discountCode: code });
      expect(r.status).toBe(400);
    }
    expect(await db.booking.count()).toBe(0);
    expect((await quote([full.id], SUN, 1, "TODAY")).body.discount).toMatchObject({ amount: 95 }); // valid through the end date
  });

  it("stops at the usage limit — even when requests arrive at the same moment", async () => {
    const full = await fullResource();
    await makeCode({ maxUses: 1 });
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) => book([full.id], addDays(SUN, i), 1, { discountCode: "JOOD10" })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400).every((r) => /انتهت الاستخدامات/.test(r.body.error))).toBe(true);
    expect((await db.discountCode.findFirstOrThrow()).usedCount).toBe(1);
    expect(await db.discountRedemption.count()).toBe(1);
    expect((await quote([full.id], addDays(SUN, 5), 1, "JOOD10")).body.discountError).toMatch(/انتهت الاستخدامات/);
  });

  it("gives the use back when the booking is cancelled, rejected or expires", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await makeCode({ maxUses: 1 });
    const code = () => db.discountCode.findFirstOrThrow();

    const a = await db.booking.findUniqueOrThrow({ where: { reference: (await book([full.id], SUN, 1, { discountCode: "JOOD10" })).body.reference } });
    await agent.post(`/api/admin/bookings/${a.id}/status`).send({ status: "CANCELLED", reason: "طلب الضيف" }).expect(200);
    expect((await code()).usedCount).toBe(0);
    expect((await db.discountRedemption.findFirstOrThrow({ where: { bookingId: a.id } })).status).toBe("RELEASED");
    // The cancelled booking keeps its record of the discount.
    expect((await db.booking.findUniqueOrThrow({ where: { id: a.id } })).discountAmount.toFixed(2)).toBe("95.00");

    const b = await db.booking.findUniqueOrThrow({ where: { reference: (await book([full.id], SUN, 1, { discountCode: "JOOD10" })).body.reference } });
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "REJECTED" }).expect(200);
    expect((await code()).usedCount).toBe(0);

    const c = await db.booking.findUniqueOrThrow({ where: { reference: (await book([full.id], SUN, 1, { discountCode: "JOOD10" })).body.reference } });
    await agent.post(`/api/admin/bookings/${c.id}/status`).send({ status: "AWAITING_PAYMENT" }).expect(200);
    await db.booking.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireStaleBookings(db);
    expect((await db.booking.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("EXPIRED");
    expect((await code()).usedCount).toBe(0);

    // A confirmed booking that is later cancelled also gives the use back (owner's decision).
    const d = await db.booking.findUniqueOrThrow({ where: { reference: (await book([full.id], SUN, 1, { discountCode: "JOOD10" })).body.reference } });
    await agent.post(`/api/admin/bookings/${d.id}/payments`).send({ method: "BANK_TRANSFER", amount: 855 }).expect(201);
    await agent.post(`/api/admin/bookings/${d.id}/payments`).send({ method: "BANK_TRANSFER", purpose: "SECURITY_DEPOSIT", amount: 500 }).expect(201);
    await agent.post(`/api/admin/bookings/${d.id}/status`).send({ status: "CONFIRMED" }).expect(200);
    expect((await code()).usedCount).toBe(1);
    await agent.post(`/api/admin/bookings/${d.id}/status`).send({ status: "CANCELLED", reason: "طلب الضيف" }).expect(200);
    expect((await code()).usedCount).toBe(0);
    expect(await db.discountRedemption.count()).toBe(4); // every use stays in the log
  });

  it("allows a «once per guest» code once per phone number, again after a cancellation", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await makeCode({ onePerGuest: true });
    const me = guest(7);
    const first = await book([full.id], SUN, 1, { discountCode: "JOOD10" }, me);
    expect(first.status).toBe(201);
    const second = await book([full.id], addDays(SUN, 1), 1, { discountCode: "JOOD10" }, me);
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/استخدمت كود الخصم/);
    expect((await book([full.id], addDays(SUN, 1), 1, { discountCode: "JOOD10" }, guest(8))).status).toBe(201);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: first.body.reference } });
    await agent.post(`/api/admin/bookings/${b.id}/status`).send({ status: "CANCELLED", reason: "طلب الضيف" }).expect(200);
    expect((await book([full.id], addDays(SUN, 2), 1, { discountCode: "JOOD10" }, me)).status).toBe(201);
  });

  it("only discounts the chosen weekdays, and can leave out holidays and occasions", async () => {
    const full = await fullResource();
    await makeCode({ code: "WEEKDAYS", daysOfWeek: [0, 1, 2, 3] });
    // Sun..Thu: 950×4 + 1200 = 5000; Sun–Wed eligible = 3800 → 10% = 380
    expect((await quote([full.id], SUN, 5, "WEEKDAYS")).body).toMatchObject({ subtotal: 5000, discount: { amount: 380 }, total: 4620 });
    expect((await quote([full.id], THU, 1, "WEEKDAYS")).body.discountError).toMatch(/لا ينطبق على الأيام المختارة/);

    await db.pricingRule.create({ data: { resourceId: full.id, kind: "SPECIAL", label: "العيد", price: 1500, startDate: fromIsoDate(SUN), endDate: fromIsoDate(SUN) } });
    await makeCode({ code: "NOHOLIDAY", includeSpecialDays: false });
    // Sun (Eid 1500) + Mon 950 → only Monday discounted
    expect((await quote([full.id], SUN, 2, "NOHOLIDAY")).body).toMatchObject({ subtotal: 2450, discount: { amount: 95 } });
    expect((await quote([full.id], SUN, 1, "NOHOLIDAY")).body.discountError).toMatch(/لا ينطبق/);
    await makeCode();
    expect((await quote([full.id], SUN, 2, "JOOD10")).body.discount.amount).toBe(245); // a code that includes occasions
  });

  it("can be limited to full-house bookings and to a minimum amount", async () => {
    const full = await fullResource();
    const part = await makePart();
    await makeCode({ code: "FULLONLY", scope: "FULL_ONLY" });
    expect((await quote([part.id], SUN, 1, "FULLONLY")).body.discountError).toMatch(/للحجز الكامل/);
    expect((await quote([full.id], SUN, 1, "FULLONLY")).body.discount.amount).toBe(95);
    await makeCode({ code: "ALLPARTS" });
    expect((await quote([part.id], SUN, 1, "ALLPARTS")).body.discount.amount).toBe(40);
    await makeCode({ code: "MIN2000", minAmount: 2000 });
    expect((await quote([full.id], SUN, 1, "MIN2000")).body.discountError).toMatch(/الحد الأدنى .* 2000 ريال/);
    expect((await quote([full.id], SUN, 3, "MIN2000")).body.discount.amount).toBe(285);
  });

  it("limits code checks per visitor so codes cannot be guessed", async () => {
    const limited = makeApp({ codeCheckLimit: 2 });
    const full = await fullResource();
    const send = (c?: string) => request(limited).post("/api/public/quote").send({ resourceIds: [full.id], startDate: SUN, nights: 1, discountCode: c });
    expect((await send("AAA")).status).toBe(200);
    expect((await send("BBB")).status).toBe(200);
    expect((await send("CCC")).status).toBe(429);
    expect((await send()).status).toBe(200); // quotes without a code are not limited
  });

  it("shows the discount in the contract", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await makeCode();
    const r = await book([full.id], SUN, 2, { discountCode: "JOOD10" });
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    const text = JSON.stringify((await agent.get(`/api/admin/bookings/${b.id}/contract`)).body.blocks);
    expect(text).toContain("الخصم (كود JOOD10)");
    expect(text).toContain("1,900 ريال");
    expect(text).toContain("1,710 ريال");
    expect(text).toContain("2,210 ريال");
  });
});

describe("managing discount codes", () => {
  const body = { code: "summer25", label: "عرض الصيف", type: "PERCENT", value: 25, startDate: null, endDate: null, maxUses: 3, onePerGuest: false, daysOfWeek: [], includeSpecialDays: true, scope: "ALL", minAmount: null, active: true };

  it("lets the owner create, edit, switch off and review usage", async () => {
    const { agent } = await signedIn(app);
    const created = await agent.post("/api/admin/discounts").send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "SUMMER25", value: 25, usedCount: 0 });
    expect((await agent.post("/api/admin/discounts").send(body)).status).toBe(409); // duplicate
    expect((await agent.post("/api/admin/discounts").send({ ...body, code: "X1X", value: 150 })).status).toBe(400); // > 100%
    expect((await agent.post("/api/admin/discounts").send({ ...body, code: "X2X", startDate: "2027-02-01", endDate: "2027-01-01" })).status).toBe(400);

    const full = await fullResource();
    await book([full.id], SUN, 1, { discountCode: "SUMMER25" });
    await book([full.id], addDays(SUN, 1), 1, { discountCode: "SUMMER25" });
    const id = created.body.id;
    expect((await agent.put(`/api/admin/discounts/${id}`).send({ ...body, maxUses: 1 })).status).toBe(400); // below used
    const edited = await agent.put(`/api/admin/discounts/${id}`).send({ ...body, value: 20, maxUses: 5 });
    expect(edited.body).toMatchObject({ value: 20, maxUses: 5 });
    // Existing bookings keep their discount.
    expect((await db.booking.findFirstOrThrow({ where: { startDate: fromIsoDate(SUN) } })).discountAmount.toFixed(2)).toBe("237.50");

    await agent.patch(`/api/admin/discounts/${id}/active`).send({ active: false }).expect(200);
    expect((await quote([full.id], addDays(SUN, 2), 1, "SUMMER25")).body.discountError).toMatch(/غير مفعّل/);

    const detail = (await agent.get(`/api/admin/discounts/${id}`)).body;
    expect(detail.redemptions).toHaveLength(2);
    expect(detail.redemptions[0]).toMatchObject({ status: "ACTIVE", guestName: "ضيف تجربة الخصم" });
    const list = (await agent.get("/api/admin/discounts")).body;
    expect(list[0]).toMatchObject({ code: "SUMMER25", usedCount: 2, totalRedemptions: 2, active: false });
  });

  it("keeps used codes for the record; unused codes can be deleted", async () => {
    const { agent } = await signedIn(app);
    const used = (await agent.post("/api/admin/discounts").send(body)).body;
    const unused = (await agent.post("/api/admin/discounts").send({ ...body, code: "UNUSED" })).body;
    await book([(await fullResource()).id], SUN, 1, { discountCode: "SUMMER25" });
    expect((await agent.delete(`/api/admin/discounts/${used.id}`)).status).toBe(409);
    expect((await agent.delete(`/api/admin/discounts/${unused.id}`)).status).toBe(204);
  });

  it("is owner-only", async () => {
    const { agent } = await signedIn(app, "STAFF");
    expect((await agent.get("/api/admin/discounts")).status).toBe(403);
    expect((await agent.post("/api/admin/discounts").send(body)).status).toBe(403);
    expect((await request(app).get("/api/admin/discounts")).status).toBe(401);
  });

  it("is protected by the database even if the app were bypassed", async () => {
    const c = await makeCode({ maxUses: 1 });
    await expect(db.discountCode.update({ where: { id: c.id }, data: { usedCount: 2 } })).rejects.toThrow();
    await expect(db.discountCode.update({ where: { id: c.id }, data: { usedCount: -1 } })).rejects.toThrow();
    await expect(makeCode({ code: "bad code" })).rejects.toThrow();
  });
});

describe("special prices and seasons", () => {
  it("sets one price for a list of separate dates without touching base prices, and shows the occasion name", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const before = await db.pricingRule.findMany({ where: { kind: "WEEKDAY" }, orderBy: { id: "asc" } });
    const res = await agent.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "عيد الفطر", dates: [SUN, addDays(SUN, 2), SUN], price: 1800 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2); // duplicate date ignored
    const q = (await quote([full.id], SUN, 3)).body;
    expect(q.lines.map((l: { price: string; ruleKind: string; ruleLabel: string | null }) => [l.price, l.ruleKind, l.ruleKind === "SPECIAL" ? l.ruleLabel : "-"])).toEqual([
      ["1800.00", "SPECIAL", "عيد الفطر"],
      ["950.00", "WEEKDAY", "-"],
      ["1800.00", "SPECIAL", "عيد الفطر"],
    ]);
    expect(await db.pricingRule.findMany({ where: { kind: "WEEKDAY" }, orderBy: { id: "asc" } })).toEqual(before);
    // The public calendar shows the special price too.
    const cal = (await request(app).get(`/api/public/calendar?from=${SUN}&to=${addDays(SUN, 2)}`)).body;
    expect(JSON.stringify(cal)).toContain("1800");
  });

  it("can be switched off, and a booking keeps the price it was made with", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const [rule] = (await agent.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "مناسبة", dates: [SUN], price: 1500 })).body;
    const r = await book([full.id], SUN, 1);
    expect(r.body.total).toBe(1500);
    await agent.patch(`/api/admin/pricing/${rule.id}/active`).send({ active: false }).expect(200);
    expect((await quote([full.id], addDays(SUN, 7), 1)).body.total).toBe(950);
    await agent.delete(`/api/admin/pricing/${rule.id}`).expect(204);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference }, include: { items: true } });
    expect(b.totalAmount.toFixed(2)).toBe("1500.00");
    expect(b.items[0]!.price.toFixed(2)).toBe("1500.00");
  });

  it("resolves overlaps: a special date beats a season, then the higher priority wins", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await agent.post("/api/admin/pricing").send({ resourceId: full.id, kind: "SEASON", label: "إجازة المدارس", startDate: SUN, endDate: addDays(SUN, 6), price: 1300 }).expect(201);
    await agent.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "يوم وطني", dates: [addDays(SUN, 1)], price: 1700 }).expect(201);
    await agent.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "عرض أقوى", dates: [addDays(SUN, 1)], price: 1600, priority: 5 }).expect(201);
    const q = (await quote([full.id], SUN, 2)).body;
    expect(q.lines.map((l: { price: string }) => l.price)).toEqual(["1300.00", "1600.00"]);
  });

  it("requires a name and the owner role", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    expect((await agent.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "", dates: [SUN], price: 1 })).status).toBe(400);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.post("/api/admin/pricing/special-dates").send({ resourceIds: [full.id], label: "x", dates: [SUN], price: 1 })).status).toBe(403);
  });
});

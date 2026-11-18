import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { manualDiscountAmount } from "../src/services/bookings.js";

const app = makeApp({ bookingLimit: 100_000, codeCheckLimit: 100_000 });

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday(); // 950
const THU = addDays(SUN, 4); // 1,200

type Agent = Awaited<ReturnType<typeof signedIn>>["agent"];
let n = 0;
async function manual(agent: Agent, extra: Record<string, unknown> = {}, startDate = THU) {
  const full = await fullResource();
  return agent.post("/api/admin/bookings").send({
    resourceIds: [full.id], startDate, nights: 1, name: "ضيف يدوي", phone: `0570000${String(++n).padStart(3, "0")}`, channel: "MANUAL", ...extra,
  });
}
const detail = async (agent: Agent, id: string) => (await agent.get(`/api/admin/bookings/${id}`)).body;

beforeEach(async () => {
  await resetDb();
  n = 0;
});
afterAll(() => db.$disconnect());

describe("manualDiscountAmount", () => {
  const base = new Prisma.Decimal(1200);
  it("computes each type", () => {
    expect(manualDiscountAmount(base, { type: "FIXED", value: 200 })).toEqual({ amount: "200.00", total: "1000.00" });
    expect(manualDiscountAmount(base, { type: "PERCENT", value: 10 })).toEqual({ amount: "120.00", total: "1080.00" });
    expect(manualDiscountAmount(base, { type: "FINAL_PRICE", value: 1000 })).toEqual({ amount: "200.00", total: "1000.00" });
    expect(manualDiscountAmount(new Prisma.Decimal(950), { type: "PERCENT", value: 12.5 })).toEqual({ amount: "118.75", total: "831.25" });
    expect(manualDiscountAmount(base, { type: "FIXED", value: 1200 })).toEqual({ amount: "1200.00", total: "0.00" });
  });
  it("refuses a discount above the base, a final price above the base and more than 100%", () => {
    expect(() => manualDiscountAmount(base, { type: "FIXED", value: 1200.01 })).toThrow();
    expect(() => manualDiscountAmount(base, { type: "FINAL_PRICE", value: 1300 })).toThrow();
    expect(() => manualDiscountAmount(base, { type: "PERCENT", value: 101 })).toThrow();
  });
});

describe("manual booking with a manual discount", () => {
  it("no discount: the base price, as before", async () => {
    const { agent } = await signedIn(app);
    const r = await manual(agent);
    expect(r.status).toBe(201);
    const b = await db.booking.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(b.totalAmount.toFixed(2)).toBe("1200.00");
    expect(b.discountAmount.toFixed(2)).toBe("0.00");
    expect(b.manualDiscountType).toBeNull();
    expect(b.manualDiscountValue).toBeNull();
  });

  it("stores base (final + discount), the discount and the final price for each type", async () => {
    const { agent } = await signedIn(app);
    const cases = [
      [{ type: "FIXED", value: 150 }, "150.00", "1050.00"],
      [{ type: "PERCENT", value: 25 }, "300.00", "900.00"],
      [{ type: "FINAL_PRICE", value: 1000 }, "200.00", "1000.00"],
    ] as const;
    for (const [i, [d, amount, total]] of cases.entries()) {
      const r = await manual(agent, { manualDiscount: d }, addDays(THU, 7 * i));
      expect(r.status).toBe(201);
      const b = await db.booking.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(b.discountAmount.toFixed(2)).toBe(amount);
      expect(b.totalAmount.toFixed(2)).toBe(total);
      expect(b.totalAmount.plus(b.discountAmount).toFixed(2)).toBe("1200.00");
      expect(b.manualDiscountType).toBe(d.type);
      expect(Number(b.manualDiscountValue)).toBe(d.value);
      expect(b.discountCode).toBeNull();
    }
  });

  it("rejects a discount larger than the base and books nothing", async () => {
    const { agent } = await signedIn(app);
    expect((await manual(agent, { manualDiscount: { type: "FIXED", value: 1500 } })).status).toBe(400);
    expect((await manual(agent, { manualDiscount: { type: "FINAL_PRICE", value: 1500 } })).status).toBe(400);
    expect((await manual(agent, { manualDiscount: { type: "PERCENT", value: 120 } })).status).toBe(400);
    expect(await db.booking.count()).toBe(0);
  });

  it("the 50% deposit plan is computed after the discount", async () => {
    const { agent } = await signedIn(app);
    const r = await manual(agent, { manualDiscount: { type: "FINAL_PRICE", value: 1000 }, paymentPlan: "DEPOSIT" });
    const b = await db.booking.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(b.upfrontAmount.toFixed(2)).toBe("500.00");
  });

  it("records the amount received with the booking; remaining = final − paid", async () => {
    const { agent } = await signedIn(app);
    const r = await manual(agent, { manualDiscount: { type: "FINAL_PRICE", value: 1000 }, initialPayment: { amount: 400, method: "CASH" }, securityDeposit: 0 });
    expect(r.status).toBe(201);
    const d = await detail(agent, r.body.id);
    expect(d.paid).toBe("400.00");
    expect(Number(d.totalAmount) - Number(d.paid)).toBe(600);
    const p = await db.payment.findFirstOrThrow({ where: { bookingId: r.body.id } });
    expect(p).toMatchObject({ purpose: "BOOKING", status: "ACCEPTED", method: "CASH" });
    expect(p.verifiedById).not.toBeNull();
    // Full amount received: the booking can be confirmed as usual.
    const full = await manual(agent, { manualDiscount: { type: "FIXED", value: 200 }, initialPayment: { amount: 1000, method: "BANK_TRANSFER" }, securityDeposit: 0 }, addDays(THU, 7));
    expect(full.status).toBe(201);
    expect(full.body.status).toBe("CONFIRMED"); // the amount received confirms it
  });

  it("refuses a received amount above the final price, with no booking left behind", async () => {
    const { agent } = await signedIn(app);
    const r = await manual(agent, { manualDiscount: { type: "FINAL_PRICE", value: 1000 }, initialPayment: { amount: 1000.01, method: "CASH" } });
    expect(r.status).toBe(400);
    expect(await db.booking.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
  });

  it("the public website ignores manual discounts and payments", async () => {
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({
      resourceIds: [full.id], startDate: THU, nights: 1, name: "ضيف موقع تجريبي", nationalId: "1023456789", phone: "0561111111", acceptTerms: true,
      manualDiscount: { type: "FIXED", value: 500 }, initialPayment: { amount: 1200, method: "CASH" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
    expect(b.totalAmount.toFixed(2)).toBe("1200.00");
    expect(b.manualDiscountType).toBeNull();
    expect(await db.payment.count()).toBe(0);
  });

  it("leaves day prices, other bookings and the discount codes untouched", async () => {
    const { agent } = await signedIn(app);
    const code = await db.discountCode.create({ data: { code: "JOOD10", type: "PERCENT", value: 10, daysOfWeek: [] } });
    await manual(agent, { manualDiscount: { type: "PERCENT", value: 50 } });
    const full = await fullResource();
    const q = (await request(app).post("/api/public/quote").send({ resourceIds: [full.id], startDate: addDays(THU, 7), nights: 1 })).body;
    expect(q.total).toBe(1200);
    const web = await request(app).post("/api/public/bookings").send({
      resourceIds: [full.id], startDate: addDays(THU, 7), nights: 1, name: "ضيف موقع تجريبي", nationalId: "1023456789", phone: "0561111112", acceptTerms: true, discountCode: "JOOD10",
    });
    expect(web.status).toBe(201);
    const b = await db.booking.findUniqueOrThrow({ where: { reference: web.body.reference } });
    expect(b.totalAmount.toFixed(2)).toBe("1080.00");
    expect(b.manualDiscountType).toBeNull();
    expect((await db.discountCode.findUniqueOrThrow({ where: { id: code.id } })).usedCount).toBe(1);
  });

  it("monthly report: booking value is the final price, discounts are reported apart", async () => {
    const { agent } = await signedIn(app);
    const r = await manual(agent, { manualDiscount: { type: "FINAL_PRICE", value: 1000 }, initialPayment: { amount: 1000, method: "CASH" }, securityDeposit: 0 });
    const rep = (await agent.get(`/api/admin/reports/monthly?year=${THU.slice(0, 4)}`)).body;
    const m = rep.months.find((x: { month: string }) => x.month === THU.slice(0, 7));
    expect(m).toMatchObject({ bookings: 1, bookingValue: 1000, discounts: 200 });
    expect(rep.total.discounts).toBe(200);
    // Money collected counts in the month it was received (today), which may differ from the booking's month.
    const today = todayInRiyadh();
    const payRep = (await agent.get(`/api/admin/reports/monthly?year=${today.slice(0, 4)}`)).body;
    expect(payRep.months.find((x: { month: string }) => x.month === today.slice(0, 7)).collected).toBe(1000);
  });
});

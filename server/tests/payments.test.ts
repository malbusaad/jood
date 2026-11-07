import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { alertUnpaidBalances } from "../src/services/bookings.js";
import type { WhatsAppSender } from "../src/services/notifications.js";

const app = makeApp({ bookingLimit: 100_000, codeCheckLimit: 100_000, publicBaseUrl: "https://jood.example" });

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday(); // 950

let n = 0;
const guest = () => ({ name: "ضيف تجربة الدفع", nationalId: "1023456789", phone: `0560000${String(++n).padStart(3, "0")}`, acceptTerms: true });

async function book(extra: Record<string, unknown> = {}, startDate = SUN) {
  const full = await fullResource();
  const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate, nights: 1, ...guest(), ...extra });
  expect(r.status).toBe(201);
  return { receipt: r.body, booking: await db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } }) };
}

type Agent = Awaited<ReturnType<typeof signedIn>>["agent"];
const pay = (agent: Agent, id: string, amount: number, purpose = "BOOKING", method = "BANK_TRANSFER") =>
  agent.post(`/api/admin/bookings/${id}/payments`).send({ method, purpose, amount });
const confirm = (agent: Agent, id: string) => agent.post(`/api/admin/bookings/${id}/status`).send({ status: "CONFIRMED" });
const detail = async (agent: Agent, id: string) => (await agent.get(`/api/admin/bookings/${id}`)).body;
async function portal(agent: Agent, id: string) {
  const link = (await agent.post(`/api/admin/bookings/${id}/guest-link`).send({})).body;
  return (await request(app).get(`/api/guest/${link.url.split("/g/")[1]}`)).body;
}

beforeEach(async () => {
  await resetDb();
  n = 0;
  await db.siteSetting.create({
    data: { key: "guestPortal", value: { entryCode: "4321", wifiName: "ALJOOD", wifiPassword: "wifi-pass-1", departureInstructions: [], linkGraceHours: 12, showCodesFrom: "IMMEDIATELY" } },
  });
});
afterAll(() => db.$disconnect());

describe("payment options at booking", () => {
  it("shows both options in the quote, with the deposit kept separate", async () => {
    const full = await fullResource();
    const q = (await request(app).post("/api/public/quote").send({ resourceIds: [full.id], startDate: SUN, nights: 1 })).body;
    expect(q).toMatchObject({ total: 950, deposit: 500, paymentOptions: { depositPlan: { percent: 50, upfront: 475 }, balanceDueHours: 24 } });
  });

  it("full payment, deposit with it: 950 + 500 due now", async () => {
    const { receipt, booking } = await book();
    expect(receipt).toMatchObject({ paymentPlan: "FULL", depositTiming: "WITH_FIRST_PAYMENT", upfront: 950, dueNow: 1450, deposit: 500, payable: 1450 });
    expect(booking).toMatchObject({ paymentPlan: "FULL", legacyPayment: false });
    expect(booking.upfrontAmount.toFixed(2)).toBe("950.00");
  });

  it("50% deposit, security deposit with it: 475 + 500 due now", async () => {
    const { receipt } = await book({ paymentPlan: "DEPOSIT" });
    expect(receipt).toMatchObject({ paymentPlan: "DEPOSIT", upfront: 475, dueNow: 975, total: 950, payable: 1450 });
  });

  it("50% deposit, security deposit before check-in: only 475 due now", async () => {
    const { receipt } = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    expect(receipt).toMatchObject({ upfront: 475, dueNow: 475 });
  });

  it("computes the 50% after the discount; the security deposit is never discounted", async () => {
    await db.discountCode.create({ data: { code: "JOOD10", type: "PERCENT", value: 10, daysOfWeek: [] } });
    const { receipt } = await book({ paymentPlan: "DEPOSIT", discountCode: "JOOD10" });
    expect(receipt).toMatchObject({ total: 855, upfront: 427.5, deposit: 500, dueNow: 927.5 });
  });

  it("ignores amounts from the browser and refuses the deposit plan when the owner turns it off", async () => {
    const { receipt } = await book({ paymentPlan: "DEPOSIT", upfront: 1, dueNow: 1, deposit: 0 });
    expect(receipt).toMatchObject({ upfront: 475, deposit: 500 });
    const { agent } = await signedIn(app);
    const policy = (await agent.get("/api/admin/settings")).body.bookingPolicy;
    await agent.put("/api/admin/settings/bookingPolicy").send({ ...policy, allowDepositPlan: false }).expect(200);
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: addDays(SUN, 1), nights: 1, ...guest(), paymentPlan: "DEPOSIT" });
    expect(r.status).toBe(400);
    expect((await request(app).post("/api/public/quote").send({ resourceIds: [full.id], startDate: addDays(SUN, 3), nights: 1 })).body.paymentOptions.depositPlan).toBeNull();
  });

  it("lets the owner change the deposit percentage and the security deposit from settings", async () => {
    const { agent } = await signedIn(app);
    const policy = (await agent.get("/api/admin/settings")).body.bookingPolicy;
    await agent.put("/api/admin/settings/bookingPolicy").send({ ...policy, depositPercent: 30, securityDeposit: 300 }).expect(200);
    const { receipt } = await book({ paymentPlan: "DEPOSIT" });
    expect(receipt).toMatchObject({ upfront: 285, deposit: 300, dueNow: 585 });
  });

  it("keeps settings saved before these options existed", async () => {
    await db.siteSetting.create({ data: { key: "bookingPolicy", value: { unpaidExpiryHours: 10, securityDeposit: 300, maxAdvanceDays: 365, maxNights: 7 } } });
    const { receipt } = await book({ paymentPlan: "DEPOSIT" });
    expect(receipt).toMatchObject({ deposit: 300, upfront: 475 });
  });
});

describe("confirmation and manual payment verification", () => {
  it("deposit plan: confirms after the 50% and the security deposit are verified — not before", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book({ paymentPlan: "DEPOSIT" });
    await pay(agent, booking.id, 475).expect(201);
    const early = await confirm(agent, booking.id);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/ومن التأمين 500/);
    await pay(agent, booking.id, 500, "SECURITY_DEPOSIT").expect(201);
    expect((await confirm(agent, booking.id)).status).toBe(200);
    const d = await detail(agent, booking.id);
    expect(d.payment).toMatchObject({ bookingPaid: "475.00", bookingRemaining: "475.00", depositStatus: "PAID", canConfirm: true, fullySettled: false });
  });

  it("deposit before check-in: confirms on the 50% alone", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    await pay(agent, booking.id, 400).expect(201);
    expect((await confirm(agent, booking.id)).status).toBe(409);
    await pay(agent, booking.id, 75).expect(201);
    expect((await confirm(agent, booking.id)).status).toBe(200);
    expect((await detail(agent, booking.id)).payment).toMatchObject({ depositStatus: "UNPAID", depositRemaining: "500.00", fullySettled: false });
  });

  it("records each payment with its date and purpose, refuses amounts above what is owed", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book();
    expect((await pay(agent, booking.id, 951)).status).toBe(400);
    expect((await pay(agent, booking.id, 501, "SECURITY_DEPOSIT")).status).toBe(400);
    const p = (await pay(agent, booking.id, 950)).body;
    expect(p).toMatchObject({ purpose: "BOOKING", kind: "PAYMENT", status: "ACCEPTED" });
    expect(p.verifiedAt).toBeTruthy();
    expect((await pay(agent, booking.id, 1)).status).toBe(400); // already fully paid
  });

  it("records refunds as new entries and never deletes payments, even after cancellation", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book();
    await pay(agent, booking.id, 950).expect(201);
    await pay(agent, booking.id, 500, "SECURITY_DEPOSIT", "CASH").expect(201);
    await confirm(agent, booking.id).expect(200);
    await agent.post(`/api/admin/bookings/${booking.id}/status`).send({ status: "CANCELLED", reason: "قبل 72 ساعة" }).expect(200);
    const refund = (purpose: string, amount: number) =>
      agent.post(`/api/admin/bookings/${booking.id}/refunds`).send({ purpose, amount, method: "BANK_TRANSFER", note: "استرداد" });
    expect((await refund("BOOKING", 951)).status).toBe(400);
    expect((await refund("BOOKING", 950)).status).toBe(201);
    expect((await refund("SECURITY_DEPOSIT", 500)).status).toBe(201);
    expect((await refund("SECURITY_DEPOSIT", 1)).status).toBe(400);
    const d = await detail(agent, booking.id);
    expect(d.payments).toHaveLength(4);
    expect(d.payment).toMatchObject({ bookingPaid: "0.00", bookingRefunded: "950.00", depositStatus: "REFUNDED" });
    expect(await db.auditLog.count({ where: { action: "payment.refund" } })).toBe(2);
    // Revenue counts booking money only, net of refunds.
    expect((await agent.get("/api/admin/dashboard")).body.revenueAll).toBe("0");
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.post(`/api/admin/bookings/${booking.id}/refunds`).send({ purpose: "BOOKING", amount: 1, method: "CASH" })).status).toBe(403);
  });

  it("keeps bookings made before this change on their old rules", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book();
    await db.booking.update({ where: { id: booking.id }, data: { legacyPayment: true } });
    await pay(agent, booking.id, 950).expect(201);
    expect((await confirm(agent, booking.id)).status).toBe(200); // deposit not required
    const p = await portal(agent, booking.id);
    expect(p.codes.entryCode).toBe("4321"); // codes shown as before
    expect(p.paymentPending).toBeNull();
  });
});

describe("door codes wait for full payment", () => {
  it("hides the entry code and Wi-Fi until the booking amount and the deposit are both verified", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book({ paymentPlan: "DEPOSIT" });
    await pay(agent, booking.id, 475).expect(201);
    await pay(agent, booking.id, 500, "SECURITY_DEPOSIT").expect(201);
    await confirm(agent, booking.id).expect(200);

    const before = await portal(agent, booking.id);
    expect(before.codes).toBeNull();
    expect(before.paymentPending).toMatchObject({ bookingRemaining: 475, depositRemaining: 0 });
    expect(JSON.stringify(before)).not.toMatch(/4321|wifi-pass-1/);

    await pay(agent, booking.id, 475).expect(201);
    const after = await portal(agent, booking.id);
    expect(after.codes).toEqual({ entryCode: "4321", wifiName: "ALJOOD", wifiPassword: "wifi-pass-1" });
    expect(after.paymentPending).toBeNull();
  });
});

describe("unpaid balance alert", () => {
  it("alerts the owner once when the deadline passes and money is still owed — nothing is cancelled", async () => {
    const { agent } = await signedIn(app);
    const sent: string[][] = [];
    const wa: WhatsAppSender = async (_to, m) => void sent.push(m.params);
    await db.siteSetting.create({ data: { key: "notifications", value: { ownerWhatsapp: "966500000000", whatsappEnabled: true } } });
    const today = todayInRiyadh();
    const { booking } = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" }, today);
    await pay(agent, booking.id, Number(booking.upfrontAmount)).expect(201);
    const c = await confirm(agent, booking.id);
    expect(c.body.error).toBeUndefined();
    const paidUp = await book({}, addDays(today, 1));
    await pay(agent, paidUp.booking.id, 950).expect(201);
    await pay(agent, paidUp.booking.id, 500, "SECURITY_DEPOSIT").expect(201);
    await confirm(agent, paidUp.booking.id).expect(200);
    await db.notification.deleteMany();

    expect(await alertUnpaidBalances(db, wa)).toBe(1);
    expect(await alertUnpaidBalances(db, wa)).toBe(0); // only once
    const notes = await db.notification.findMany({ where: { type: "PAYMENT_DUE" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.bookingId).toBe(booking.id);
    const remaining = booking.totalAmount.sub(booking.upfrontAmount).toFixed(2); // today's price may be 950 or 1,200
    expect(notes[0]!.body).toContain(`المتبقي من مبلغ الحجز: ${remaining} ريال`);
    expect(notes[0]!.body).toContain("التأمين غير مسدد: 500.00 ريال");
    expect(sent).toHaveLength(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
  });

  it("does not alert before the deadline", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    await pay(agent, booking.id, 475).expect(201);
    await confirm(agent, booking.id).expect(200);
    expect(await alertUnpaidBalances(db, null)).toBe(0);
  });
});

describe("manual bookings and the contract", () => {
  it("lets the owner set the plan and a different security deposit (e.g. none for Gathern)", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    const r = await agent.post("/api/admin/bookings").send({
      resourceIds: [full.id], startDate: SUN, nights: 1, name: "ضيف جاذر إن", phone: "0551234567", channel: "GATHERN", securityDeposit: 0,
    });
    expect(r.status).toBe(201);
    expect(r.body.depositAmount).toBe("0");
    await pay(agent, r.body.id, 950, "BOOKING", "GATHERN").expect(201);
    expect((await confirm(agent, r.body.id)).status).toBe(200);
  });

  it("states the payment plan in the contract", async () => {
    const { agent } = await signedIn(app);
    const { booking } = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    const text = JSON.stringify((await agent.get(`/api/admin/bookings/${booking.id}/contract`)).body.blocks);
    expect(text).toContain("عربون 475 ريال مقدمًا، والباقي 475 ريال قبل موعد الدخول بـ 24 ساعة");
    expect(text).toContain("سداد التأمين");
  });
});

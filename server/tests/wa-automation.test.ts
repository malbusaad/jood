import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { makeSecretBox } from "../src/lib/secretBox.js";
import { checkinInstant } from "../src/services/doorCodes.js";
import { checkoutInstant } from "../src/services/guestAccess.js";
import type { LockClient } from "../src/services/ttlock.js";
import type { WhatsAppSender, WhatsAppTemplateSender } from "../src/services/notifications.js";
import { processDueMessages } from "../src/services/waAutomation.js";
import { metaTemplateText, render } from "../src/services/waTemplates.js";
import { settingDefinitions } from "../src/settings/registry.js";

const box = makeSecretBox("test-secret-test-secret-test-secret-1", "door-codes");
const HOUR = 3600_000;

function fakeLock(opts: { failAdd?: boolean } = {}) {
  const codes = new Map<string, { code: string; startsAt: Date; endsAt: Date }>();
  let next = 1;
  const lock: LockClient & { codes: typeof codes; adds: number } = {
    lockId: "123456",
    codes,
    adds: 0,
    async addPasscode(p) {
      lock.adds++;
      if (opts.failAdd) throw new Error("TTLock -3002: gateway offline");
      const id = String(next++);
      codes.set(id, p);
      return { externalId: id };
    },
    async deletePasscode(id) {
      codes.delete(id);
    },
    async listLocks() {
      return [];
    },
  };
  return lock;
}

/** Fake WhatsApp: records every template sent; can be told to fail. */
function fakeWa() {
  const sent: { to: string; template: string; language: string; params: string[] }[] = [];
  const state = { fail: false };
  const send: WhatsAppTemplateSender = async (to, msg) => {
    if (state.fail) throw new Error(`WhatsApp API 400 (131026): message undeliverable ${msg.params.join(" ")}`);
    sent.push({ to, ...msg });
    return { id: `wamid.${sent.length}` };
  };
  return { send, sent, state };
}

const ownerAlerts: string[][] = [];
const ownerWa: WhatsAppSender = async (_to, m) => void ownerAlerts.push(m.params);

function nextSunday(): string {
  let d = addDays(todayInRiyadh(), 7);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = nextSunday();

const IBAN = "SA0380000000608010167519";

async function setMode(mode: "OFF" | "TEST" | "LIVE", templates = true) {
  const init = settingDefinitions.whatsappAutomation.initial;
  const messages = Object.fromEntries(
    Object.entries(init.messages).map(([k, v]) => [k, { ...v, templateName: templates ? `jood_${k.toLowerCase()}` : null }]),
  );
  await db.siteSetting.upsert({
    where: { key: "whatsappAutomation" },
    create: { key: "whatsappAutomation", value: { ...init, mode, messages } },
    update: { value: { ...init, mode, messages } },
  });
}

let lock: ReturnType<typeof fakeLock>;
let wa: ReturnType<typeof fakeWa>;
let app: ReturnType<typeof makeApp>;
const deps = () => ({ send: wa.send, ownerWhatsapp: ownerWa, secretBox: box });

beforeEach(async () => {
  await resetDb();
  ownerAlerts.length = 0;
  lock = fakeLock();
  wa = fakeWa();
  app = makeApp({ lock, secretBox: box, bookingLimit: 100_000, waSend: wa.send });
  await db.siteSetting.createMany({
    data: [
      { key: "doorLock", value: { enabled: true } },
      { key: "bank", value: { bankName: "مصرف الراجحي", accountHolder: "استراحة الجود", iban: IBAN, instructions: null } },
      { key: "notifications", value: { ownerWhatsapp: "966500000000", whatsappEnabled: true } },
      {
        key: "guestPortal",
        value: { entryCode: null, wifiName: "ALJOOD", wifiPassword: "wifi-pass-1", departureInstructions: [], linkGraceHours: 12, showCodesFrom: "CHECKIN_DAY", arrivalInstructions: "البوابة الثانية جهة الشرق." },
      },
    ],
  });
});
afterAll(() => db.$disconnect());

async function book(extra: Record<string, unknown> = {}, start = SUN) {
  const full = await fullResource();
  const r = await request(app)
    .post("/api/public/bookings")
    .send({ resourceIds: [full.id], startDate: start, nights: 1, name: "سارة محمد القحطاني", nationalId: "1023456789", phone: "0500000001", acceptTerms: true, ...extra });
  expect(r.status).toBe(201);
  return db.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
}
type Agent = Awaited<ReturnType<typeof signedIn>>["agent"];
const status = (agent: Agent, id: string, s: string) => agent.post(`/api/admin/bookings/${id}/status`).send({ status: s, reason: "x" });
const pay = (agent: Agent, id: string, amount: number, purpose = "BOOKING") => agent.post(`/api/admin/bookings/${id}/payments`).send({ method: "BANK_TRANSFER", purpose, amount });
const msg = (bookingId: string, kind: string) => db.whatsAppMessage.findUniqueOrThrow({ where: { bookingId_kind: { bookingId, kind: kind as never } } });

/** Confirmed, fully paid booking (door code created by TTLock on confirmation). */
async function confirmedPaid(agent: Agent, extra: Record<string, unknown> = {}, start = SUN) {
  const b = await book(extra, start);
  await pay(agent, b.id, Number(b.totalAmount)).expect(201);
  await pay(agent, b.id, 500, "SECURITY_DEPOSIT").expect(201);
  await status(agent, b.id, "CONFIRMED").expect(200);
  return b;
}

describe("safety: nothing is sent unless the owner switches it on", () => {
  it("is off by default — messages are logged as skipped, nothing is sent", async () => {
    const b = await book();
    await processDueMessages(db, deps());
    expect(await msg(b.id, "REQUEST_RECEIVED")).toMatchObject({ status: "SKIPPED", lastError: "الأتمتة متوقفة" });
    expect(wa.sent).toHaveLength(0);
  });

  it("test mode prepares the message and shows it in the log without sending", async () => {
    await setMode("TEST");
    const b = await book();
    await processDueMessages(db, deps());
    const m = await msg(b.id, "REQUEST_RECEIVED");
    expect(m.status).toBe("DRY_RUN");
    expect(m.preview).toContain("استلمنا طلب حجزك رقم JD-");
    expect(wa.sent).toHaveLength(0);
  });

  it("live mode needs an approved template name", async () => {
    await setMode("LIVE", false);
    const b = await book();
    await processDueMessages(db, deps());
    expect(await msg(b.id, "REQUEST_RECEIVED")).toMatchObject({ status: "FAILED", lastError: "لم يُحدد اسم القالب المعتمد لهذه الرسالة" });
    expect(wa.sent).toHaveLength(0);
  });
});

describe("messages on booking events", () => {
  it("request received: sent once with the template and its values in order", async () => {
    await setMode("LIVE");
    const b = await book();
    await processDueMessages(db, deps());
    await processDueMessages(db, deps());
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0]).toMatchObject({ to: "966500000001", template: "jood_request_received", language: "ar" });
    expect(wa.sent[0]!.params).toEqual(["سارة", b.reference, expect.stringContaining("الأحد")]);
    expect(await msg(b.id, "REQUEST_RECEIVED")).toMatchObject({ status: "SENT", providerId: "wamid.1" });
  });

  it("acceptance: amounts, deposit and the bank transfer details", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await book({ paymentPlan: "DEPOSIT" });
    await status(agent, b.id, "AWAITING_PAYMENT").expect(200);
    await processDueMessages(db, deps());
    const accepted = wa.sent.find((s) => s.template === "jood_booking_accepted")!;
    const text = accepted.params.join(" | ");
    expect(text).toContain("950 ريال"); // booking amount
    expect(text).toContain("975 ريال"); // 475 deposit + 500 security deposit due now
    expect(text).toContain("500 ريال");
    expect(text).toContain(IBAN);
    expect(accepted.params.every((p) => !/[\n\t]/.test(p))).toBe(true); // Meta refuses new lines in values
  });

  it("confirmation: payment received now; reminder 24h, entry code 2h before check-in, thanks 3h after check-out", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    const checkIn = checkinInstant(b.startDate, "14:00").getTime();
    const checkOut = checkoutInstant(b.endDate, "04:00").getTime();
    expect((await msg(b.id, "REMINDER")).scheduledAt.getTime()).toBe(checkIn - 24 * HOUR);
    expect((await msg(b.id, "ACCESS")).scheduledAt.getTime()).toBe(checkIn - 2 * HOUR);
    expect((await msg(b.id, "THANK_YOU")).scheduledAt.getTime()).toBe(checkOut + 3 * HOUR);
    await processDueMessages(db, deps());
    expect(wa.sent.map((s) => s.template)).toEqual(["jood_request_received", "jood_payment_confirmed"]);
    expect(wa.sent[1]!.params.join(" ")).toContain("تم استلام كامل مبلغ الحجز والتأمين");
  });

  it("24h reminder: asks for what is still owed, or says all is paid", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const unpaid = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    await pay(agent, unpaid.id, 475).expect(201);
    await status(agent, unpaid.id, "CONFIRMED").expect(200);
    const paid = await confirmedPaid(agent, { phone: "0500000002" }, addDays(SUN, 1));
    const at = (b: { startDate: Date }) => new Date(checkinInstant(b.startDate, "14:00").getTime() - 23 * HOUR);
    await processDueMessages(db, deps(), at(unpaid));
    await processDueMessages(db, deps(), at(paid));
    const reminders = wa.sent.filter((s) => s.template === "jood_reminder");
    expect(reminders).toHaveLength(2);
    const forUnpaid = reminders.find((r) => r.to === "966500000001")!.params.join(" ");
    expect(forUnpaid).toContain("المتبقي من مبلغ الحجز 475 ريال والتأمين 500 ريال");
    expect(forUnpaid).toContain("يرجى السداد قبل");
    expect(reminders.find((r) => r.to === "966500000002")!.params.join(" ")).toContain("تم استلام كامل مبلغ الحجز والتأمين");
    expect(paid).toBeTruthy();
  });

  it("cancellation stops pending messages", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    await status(agent, b.id, "CANCELLED").expect(200);
    for (const k of ["REMINDER", "ACCESS", "THANK_YOU"]) expect((await msg(b.id, k)).status).toBe("SKIPPED");
  });
});

describe("entry code message (2 hours before check-in)", () => {
  const twoHoursBefore = (b: { startDate: Date }) => new Date(checkinInstant(b.startDate, "14:00").getTime() - 2 * HOUR + 60_000);

  it("sends the TTLock code of this booking when everything is paid — the stored copy hides it", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    const code = [...lock.codes.values()][0]!.code;
    await processDueMessages(db, deps(), twoHoursBefore(b));
    const access = wa.sent.find((s) => s.template === "jood_access")!;
    expect(access.params).toContain(code);
    expect(access.params.join(" ")).toContain("البوابة الثانية جهة الشرق.");
    const m = await msg(b.id, "ACCESS");
    expect(m.status).toBe("SENT");
    expect(m.preview).not.toContain(code);
    expect(m.preview).toContain("••••••");
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(code);
    expect(lock.adds).toBe(1); // no new code was generated
  });

  it("never sends the code when payment is incomplete: the guest gets a payment notice, the owner an alert", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await book({ paymentPlan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN" });
    await pay(agent, b.id, 475).expect(201);
    await status(agent, b.id, "CONFIRMED").expect(200);
    const code = [...lock.codes.values()][0]!.code;
    const t = twoHoursBefore(b);
    await processDueMessages(db, deps(), t);
    expect(await msg(b.id, "ACCESS")).toMatchObject({ status: "BLOCKED", lastError: "لم يكتمل السداد والتأمين" });
    await processDueMessages(db, deps(), t);
    expect(wa.sent.some((s) => s.params.includes(code))).toBe(false);
    const notice = wa.sent.find((s) => s.template === "jood_payment_pending")!;
    expect(notice.params.join(" ")).toContain("المتبقي من مبلغ الحجز 475 ريال");
    expect(await db.notification.count({ where: { type: "PAYMENT_DUE", title: { contains: "لم يُرسل رمز الدخول" } } })).toBe(1);

    // The owner verifies the rest: the entry-code message goes out by itself, with the same code.
    await pay(agent, b.id, 475).expect(201);
    await pay(agent, b.id, 500, "SECURITY_DEPOSIT").expect(201);
    expect((await msg(b.id, "ACCESS")).status).toBe("SCHEDULED");
    await processDueMessages(db, deps(), new Date(t.getTime() + 60_000));
    expect(wa.sent.filter((s) => s.template === "jood_access")).toHaveLength(1);
    expect(wa.sent.find((s) => s.template === "jood_access")!.params).toContain(code);
    expect(lock.adds).toBe(1);
  });

  it("does not send when TTLock failed to create the code — the owner is alerted", async () => {
    lock = fakeLock({ failAdd: true });
    app = makeApp({ lock, secretBox: box, bookingLimit: 100_000, waSend: wa.send });
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    await processDueMessages(db, deps(), twoHoursBefore(b));
    expect(await msg(b.id, "ACCESS")).toMatchObject({ status: "BLOCKED", lastError: expect.stringContaining("فشل إنشاؤه في TTLock") });
    expect(wa.sent.some((s) => s.template === "jood_access")).toBe(false);
    expect(await db.notification.count({ where: { title: { contains: "لم يُرسل رمز الدخول" } } })).toBe(1);
  });

  it("does not send a code whose validity does not match the stay", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    await db.doorCode.updateMany({ data: { endsAt: new Date(Date.now() + 999 * HOUR) } });
    await processDueMessages(db, deps(), twoHoursBefore(b));
    expect(await msg(b.id, "ACCESS")).toMatchObject({ status: "BLOCKED", lastError: expect.stringContaining("لا تطابق موعد الحجز") });
  });

  it("WhatsApp failure: logged with the reason (code hidden); retry sends the same message once, with no new code", async () => {
    await setMode("LIVE");
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    const code = [...lock.codes.values()][0]!.code;
    wa.state.fail = true;
    await processDueMessages(db, deps(), twoHoursBefore(b));
    const failed = await msg(b.id, "ACCESS");
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toContain("131026");
    expect(failed.lastError).not.toContain(code);

    wa.state.fail = false;
    const id = failed.id;
    expect((await agent.post(`/api/admin/whatsapp/messages/${id}/retry`).send({})).status).toBe(200);
    expect((await agent.post(`/api/admin/whatsapp/messages/${id}/retry`).send({})).status).toBe(409); // already queued
    await processDueMessages(db, deps(), new Date(twoHoursBefore(b).getTime() + 60_000));
    expect(wa.sent.filter((s) => s.template === "jood_access")).toHaveLength(1);
    expect(await db.whatsAppMessage.count({ where: { bookingId: b.id, kind: "ACCESS" } })).toBe(1);
    expect(lock.adds).toBe(1);
  });
});

describe("reliability", () => {
  it("two workers at the same time never send a message twice", async () => {
    await setMode("LIVE");
    for (let i = 0; i < 5; i++) await book({ phone: `050000010${i}` }, addDays(SUN, i));
    await Promise.all([processDueMessages(db, deps()), processDueMessages(db, deps()), processDueMessages(db, deps())]);
    expect(wa.sent).toHaveLength(5);
  });

  it("a send interrupted by a crash is marked for the owner, not resent blindly", async () => {
    await setMode("LIVE");
    const b = await book();
    await db.whatsAppMessage.updateMany({ data: { status: "SENDING" } });
    await db.$executeRaw`UPDATE "whatsapp_messages" SET "updated_at" = now() - interval '1 hour'`;
    await processDueMessages(db, deps());
    expect(await msg(b.id, "REQUEST_RECEIVED")).toMatchObject({ status: "FAILED", lastError: expect.stringContaining("انقطع الإرسال") });
    expect(wa.sent).toHaveLength(0);
  });

  it("follows new reminder times set by the owner", async () => {
    const { agent } = await signedIn(app);
    const b = await confirmedPaid(agent);
    const s = (await agent.get("/api/admin/settings")).body.whatsappAutomation;
    await agent.put("/api/admin/settings/whatsappAutomation").send({ ...s, reminderHoursBefore: 48 }).expect(200);
    expect((await msg(b.id, "REMINDER")).scheduledAt.getTime()).toBe(checkinInstant(b.startDate, "14:00").getTime() - 48 * HOUR);
  });
});

describe("templates and admin", () => {
  it("turns the editable text into the Meta template text and fills values in order", () => {
    expect(metaTemplateText("أهلًا {customer_name}، حجزك {booking_reference} يوم {booking_date}")).toBe("أهلًا {{1}}، حجزك {{2}} يوم {{3}}");
    expect(render("{customer_name} - {door_code}", { customer_name: "سارة\nمحمد", door_code: "123456" }).params).toEqual(["سارة — محمد", "123456"]);
  });

  it("rejects unknown variables in a message text", async () => {
    const { agent } = await signedIn(app);
    const s = (await agent.get("/api/admin/settings")).body.whatsappAutomation;
    s.messages.THANK_YOU.text = "شكرًا {guest_mood}";
    const r = await agent.put("/api/admin/settings/whatsappAutomation").send(s);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("guest_mood");
  });

  it("shows status and the log; sends a test message only to the number the owner types", async () => {
    const { agent } = await signedIn(app);
    await setMode("TEST");
    await book();
    await processDueMessages(db, deps());
    const st = (await agent.get("/api/admin/whatsapp/status")).body;
    expect(st).toMatchObject({ connection: { configured: false }, mode: "TEST" });
    expect(st.messages.find((m: { kind: string }) => m.kind === "REQUEST_RECEIVED").metaTemplate).toContain("{{1}}");
    const log = (await agent.get("/api/admin/whatsapp/messages")).body;
    expect(log.items[0]).toMatchObject({ kind: "REQUEST_RECEIVED", status: "DRY_RUN" });
    expect(log.counts.DRY_RUN).toBe(1);

    const t = await agent.post("/api/admin/whatsapp/test").send({ kind: "ACCESS", to: "0555555555" });
    expect(t.status).toBe(200);
    expect(wa.sent.at(-1)).toMatchObject({ to: "966555555555", template: "jood_access" });
    expect(wa.sent.at(-1)!.params).toContain("000000"); // sample code, not a real one

    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.get("/api/admin/whatsapp/status")).status).toBe(403);
    expect((await staff.post("/api/admin/whatsapp/test").send({ kind: "ACCESS", to: "0555555555" })).status).toBe(403);
  });
});

import { Prisma, type PrismaClient, type WaMessageKind } from "@prisma/client";
import { formatDateAr, formatSAR, formatTimeAr } from "../lib/format.js";
import { toIsoDate } from "../lib/dates.js";
import type { SecretBox } from "../lib/secretBox.js";
import { getSettings, type SettingValue } from "../settings/registry.js";
import { checkinInstant, stayWindow } from "./doorCodes.js";
import { checkoutInstant } from "./guestAccess.js";
import { paymentSummary, type PaymentSummary } from "./payments.js";
import { notifyOwner, type WhatsAppSender, type WhatsAppTemplateSender } from "./notifications.js";
import { DEFAULT_WA_MESSAGES, render, type WaKind } from "./waTemplates.js";

type Tx = PrismaClient | Prisma.TransactionClient;
const HOUR = 3600_000;
const MASK = "••••••";

export interface WaDeps {
  /** Sends approved templates to guests; null until the WhatsApp account is connected. */
  send: WhatsAppTemplateSender | null;
  /** Owner alerts (in-panel always; WhatsApp when configured). */
  ownerWhatsapp: WhatsAppSender | null;
  secretBox: SecretBox;
}

// ─────────────────────────── scheduling (called inside booking transactions) ───────────────────────────

async function queue(tx: Tx, bookingId: string, kind: WaMessageKind, scheduledAt: Date, status: "SCHEDULED" | "SKIPPED" = "SCHEDULED", lastError?: string) {
  // One message per booking and kind: a second event never creates a duplicate.
  await tx.whatsAppMessage.createMany({ data: [{ bookingId, kind, scheduledAt, status, lastError: lastError ?? null }], skipDuplicates: true });
}

async function timing(tx: Tx) {
  const s = await getSettings(tx, ["whatsappAutomation", "stay"]);
  return { auto: s.whatsappAutomation, stay: s.stay };
}

export function timedSchedule(b: { startDate: Date; endDate: Date }, auto: SettingValue<"whatsappAutomation">, stay: SettingValue<"stay">) {
  const checkIn = checkinInstant(b.startDate, stay.checkIn);
  const checkOut = checkoutInstant(b.endDate, stay.checkOut);
  return {
    REMINDER: new Date(checkIn.getTime() - auto.reminderHoursBefore * HOUR),
    ACCESS: new Date(checkIn.getTime() - auto.accessHoursBefore * HOUR),
    THANK_YOU: new Date(checkOut.getTime() + auto.thankYouHoursAfter * HOUR),
  };
}

export async function onBookingRequested(tx: Tx, bookingId: string) {
  await queue(tx, bookingId, "REQUEST_RECEIVED", new Date());
}

export async function onBookingAccepted(tx: Tx, bookingId: string) {
  await queue(tx, bookingId, "BOOKING_ACCEPTED", new Date());
}

export async function onBookingConfirmed(tx: Tx, b: { id: string; startDate: Date; endDate: Date }, now = new Date()) {
  const { auto, stay } = await timing(tx);
  const t = timedSchedule(b, auto, stay);
  await queue(tx, b.id, "PAYMENT_CONFIRMED", now);
  // A reminder whose time already passed (late confirmation) is not sent; the access message is (the guest needs it).
  if (t.REMINDER > now) await queue(tx, b.id, "REMINDER", t.REMINDER);
  else await queue(tx, b.id, "REMINDER", now, "SKIPPED", "تأكد الحجز بعد موعد التذكير");
  await queue(tx, b.id, "ACCESS", t.ACCESS > now ? t.ACCESS : now);
  await queue(tx, b.id, "THANK_YOU", t.THANK_YOU);
}

export async function onBookingClosed(tx: Tx, bookingId: string, reason: string) {
  await tx.whatsAppMessage.updateMany({ where: { bookingId, status: "SCHEDULED" }, data: { status: "SKIPPED", lastError: reason } });
}

/** After the owner changes the reminder/access/thank-you hours, pending messages follow the new times. */
export async function rescheduleTimed(db: PrismaClient, now = new Date()) {
  const { auto, stay } = await timing(db);
  const pending = await db.whatsAppMessage.findMany({
    where: { status: "SCHEDULED", kind: { in: ["REMINDER", "ACCESS", "THANK_YOU"] } },
    include: { booking: { select: { startDate: true, endDate: true } } },
  });
  for (const m of pending) {
    const t = timedSchedule(m.booking, auto, stay)[m.kind as "REMINDER" | "ACCESS" | "THANK_YOU"];
    const at = m.kind === "ACCESS" && t < now ? now : t;
    if (at.getTime() !== m.scheduledAt.getTime()) await db.whatsAppMessage.update({ where: { id: m.id }, data: { scheduledAt: at } });
  }
}

// ─────────────────────────── message content ───────────────────────────

type Settings = Awaited<ReturnType<typeof loadSettings>>;
function loadSettings(db: Tx) {
  return getSettings(db, ["whatsappAutomation", "stay", "bookingPolicy", "bank", "guestPortal", "doorLock", "contact", "notifications"]);
}

function riyadhDateTime(d: Date) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(d);
}

function paymentNote(sum: PaymentSummary) {
  if (sum.fullySettled) return "تم استلام كامل مبلغ الحجز والتأمين، شكرًا لك.";
  const parts = [
    Number(sum.bookingRemaining) > 0 ? `المتبقي من مبلغ الحجز ${formatSAR(sum.bookingRemaining)}` : null,
    Number(sum.depositRemaining) > 0 ? `والتأمين ${formatSAR(sum.depositRemaining)}` : null,
  ].filter(Boolean);
  const by = sum.balanceDueAt ? `، يرجى السداد قبل ${riyadhDateTime(sum.balanceDueAt)}` : "";
  return `${parts.join(" ")}${by}.`;
}

function paymentInstructions(s: Settings) {
  const b = s.bank;
  if (!b.iban) return "نرسل لك بيانات الدفع هنا";
  return ["تحويل بنكي", b.bankName, `الآيبان ${b.iban}`, b.accountHolder ? `باسم ${b.accountHolder}` : null].filter(Boolean).join(" — ");
}

type BookingForMessage = Prisma.BookingGetPayload<{
  include: { guest: true; payments: true; items: { include: { resource: { select: { id: true; name: true } } } } };
}>;

export function buildVariables(b: BookingForMessage, s: Settings, sum: PaymentSummary, doorCode: string | null): Record<string, string> {
  const items = [...new Map(b.items.map((i) => [i.resource.id, i.resource.name])).values()].join("، ");
  return {
    customer_name: b.guest.name.split(" ")[0] ?? b.guest.name,
    booking_reference: b.reference,
    booking_date: formatDateAr(toIsoDate(b.startDate)),
    booking_items: items || "—",
    booking_amount: formatSAR(b.totalAmount.toFixed(2)),
    amount_due_now: formatSAR(sum.dueToConfirm),
    remaining_amount: formatSAR(sum.bookingRemaining),
    security_deposit: formatSAR(b.depositAmount.toFixed(2)),
    deposit_remaining: formatSAR(sum.depositRemaining),
    payment_instructions: paymentInstructions(s),
    payment_status_note: paymentNote(sum),
    balance_due_by: sum.balanceDueAt ? riyadhDateTime(sum.balanceDueAt) : "—",
    check_in_time: formatTimeAr(s.stay.checkIn),
    check_out_time: formatTimeAr(s.stay.checkOut),
    door_code: doorCode ?? "—",
    wifi_name: s.guestPortal.wifiName ?? "—",
    wifi_password: s.guestPortal.wifiPassword ?? "—",
    arrival_instructions: s.guestPortal.arrivalInstructions ?? "",
    location_url: s.contact.mapUrl ?? "—",
  };
}

/**
 * The code to give the guest — never a new one: the code TTLock already created for this booking,
 * only if it is active and valid exactly for this stay. When the lock is not used, the fixed entry code.
 */
async function accessCode(db: PrismaClient, box: SecretBox, b: BookingForMessage, s: Settings): Promise<{ code: string } | { problem: string }> {
  if (!s.doorLock.enabled) {
    return s.guestPortal.entryCode ? { code: s.guestPortal.entryCode } : { problem: "لا يوجد رمز دخول: قفل TTLock غير مفعّل ورمز الدخول الثابت غير محدد" };
  }
  const c = await db.doorCode.findFirst({ where: { bookingId: b.id }, orderBy: { createdAt: "desc" } });
  if (!c) return { problem: "لم يُنشأ رمز الباب لهذا الحجز بعد" };
  if (c.status !== "ACTIVE" || !c.codeEncrypted) return { problem: `رمز الباب غير صالح (${c.status === "FAILED" ? "فشل إنشاؤه في TTLock" : "محذوف"})` };
  const w = stayWindow(b.items.map((i) => toIsoDate(i.date)), s.stay);
  if (!w || c.startsAt.getTime() !== w.startsAt.getTime() || c.endsAt.getTime() !== w.endsAt.getTime()) {
    return { problem: "صلاحية رمز الباب لا تطابق موعد الحجز؛ أعد إنشاء الرمز" };
  }
  const code = box.open(c.codeEncrypted);
  return code ? { code } : { problem: "تعذر قراءة رمز الباب المحفوظ" };
}

const STATUS_OK: Record<WaMessageKind, string[]> = {
  REQUEST_RECEIVED: ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"],
  BOOKING_ACCEPTED: ["AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"],
  PAYMENT_CONFIRMED: ["CONFIRMED"],
  REMINDER: ["CONFIRMED"],
  ACCESS: ["CONFIRMED"],
  PAYMENT_PENDING: ["CONFIRMED"],
  THANK_YOU: ["CONFIRMED", "COMPLETED"],
};

// ─────────────────────────── sending ───────────────────────────

type Outcome = { status: "SENT" | "FAILED" | "SKIPPED" | "BLOCKED" | "DRY_RUN"; error?: string; preview?: string; providerId?: string | null };

async function deliver(db: PrismaClient, deps: WaDeps, messageId: string, now: Date): Promise<Outcome> {
  const m = await db.whatsAppMessage.findUniqueOrThrow({
    where: { id: messageId },
    include: { booking: { include: { guest: true, payments: true, items: { include: { resource: { select: { id: true, name: true } } } } } } },
  });
  const b = m.booking;
  const s = await loadSettings(db);
  const cfg = s.whatsappAutomation.messages[m.kind as WaKind];

  if (s.whatsappAutomation.mode === "OFF") return { status: "SKIPPED", error: "الأتمتة متوقفة" };
  if (!cfg.enabled) return { status: "SKIPPED", error: "هذه الرسالة معطلة في الإعدادات" };
  if (!STATUS_OK[m.kind].includes(b.status)) return { status: "SKIPPED", error: `حالة الحجز لا تسمح (${b.status})` };

  const checkIn = checkinInstant(b.startDate, s.stay.checkIn);
  const checkOut = checkoutInstant(b.endDate, s.stay.checkOut);
  if (m.kind === "REMINDER" && now >= checkIn) return { status: "SKIPPED", error: "فات موعد التذكير" };
  if ((m.kind === "ACCESS" || m.kind === "PAYMENT_PENDING") && now >= checkOut) return { status: "SKIPPED", error: "انتهى موعد الحجز" };
  if (m.kind === "THANK_YOU" && now.getTime() > checkOut.getTime() + 7 * 24 * HOUR) return { status: "SKIPPED", error: "فات موعد رسالة الشكر" };

  const sum = paymentSummary(b, { checkIn: s.stay.checkIn, balanceDueHours: s.bookingPolicy.balanceDueHours });
  let doorCode: string | null = null;
  if (m.kind === "ACCESS") {
    // Security rule: the code goes out only when the booking amount and the deposit are fully paid and verified.
    if (!sum.fullySettled) {
      await queue(db, b.id, "PAYMENT_PENDING", now);
      await notifyOwner(
        db,
        {
          type: "PAYMENT_DUE",
          title: `لم يُرسل رمز الدخول ${b.reference}`,
          body: `${b.guest.name} — ${b.guest.phone}\nلم يكتمل السداد: ${paymentNote(sum)}\nأُرسل للضيف تنبيه بعدم اكتمال السداد. بعد اعتماد المبلغ أعد إرسال رسالة رمز الدخول من «أتمتة واتساب».`,
          bookingId: b.id,
          whatsappParams: [b.reference, b.guest.name, b.guest.phone ?? "—", formatDateAr(toIsoDate(b.startDate)), "لم يكتمل السداد"],
        },
        deps.ownerWhatsapp,
      );
      return { status: "BLOCKED", error: "لم يكتمل السداد والتأمين" };
    }
    const code = await accessCode(db, deps.secretBox, b, s);
    if ("problem" in code) {
      await notifyOwner(
        db,
        {
          type: "SYSTEM",
          title: `لم يُرسل رمز الدخول ${b.reference}`,
          body: `${b.guest.name} — ${b.guest.phone}\n${code.problem}\nلم تُرسل أي رسالة برمز غير صالح. بعد إصلاحه أعد المحاولة من «أتمتة واتساب».`,
          bookingId: b.id,
          whatsappParams: [b.reference, b.guest.name, b.guest.phone ?? "—", formatDateAr(toIsoDate(b.startDate)), code.problem],
        },
        deps.ownerWhatsapp,
      );
      return { status: "BLOCKED", error: code.problem };
    }
    doorCode = code.code;
  }

  const vars = buildVariables(b, s, sum, doorCode);
  const { params, text } = render(cfg.text, vars);
  // The stored copy never contains the door code.
  const preview = doorCode ? render(cfg.text, { ...vars, door_code: MASK }).text : text;

  if (s.whatsappAutomation.mode === "TEST") return { status: "DRY_RUN", preview };
  if (!b.guest.phone) return { status: "SKIPPED", preview, error: "لا يوجد رقم جوال للضيف" };
  if (!deps.send) return { status: "FAILED", preview, error: "حساب واتساب غير مربوط بعد (إعدادات الخادم)" };
  if (!cfg.templateName) return { status: "FAILED", preview, error: "لم يُحدد اسم القالب المعتمد لهذه الرسالة" };

  try {
    const r = await deps.send(b.guest.phone!, { template: cfg.templateName, language: cfg.language, params });
    return { status: "SENT", preview, providerId: r.id };
  } catch (err) {
    let reason = err instanceof Error ? err.message : "unknown error";
    if (doorCode) reason = reason.split(doorCode).join(MASK);
    return { status: "FAILED", preview, error: reason.slice(0, 480) };
  }
}

/**
 * Sends every message whose time has come. Rows are claimed with SKIP LOCKED, so two runs (or two
 * servers) never send the same message. Runs every minute; safe after restarts (state is in the DB).
 */
export async function processDueMessages(db: PrismaClient, deps: WaDeps, now = new Date(), limit = 20) {
  // A send interrupted by a crash is not retried blindly (it may have gone out): the owner decides.
  await db.whatsAppMessage.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    data: { status: "FAILED", lastError: "انقطع الإرسال؛ تأكد من وصول الرسالة قبل إعادة المحاولة" },
  });
  const claimed = await db.$queryRaw<{ id: string; scheduled_at: Date }[]>`
    UPDATE "whatsapp_messages" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updated_at" = now()
    WHERE "id" IN (
      SELECT "id" FROM "whatsapp_messages"
      WHERE "status" = 'SCHEDULED' AND "scheduled_at" <= ${now}
      ORDER BY "scheduled_at" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "scheduled_at"`;
  // RETURNING has no guaranteed order: send in the order the messages were due.
  claimed.sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime());
  const results: Outcome["status"][] = [];
  for (const { id } of claimed) {
    let out: Outcome;
    try {
      out = await deliver(db, deps, id, now);
    } catch (err) {
      out = { status: "FAILED", error: (err instanceof Error ? err.message : "error").slice(0, 480) };
    }
    await db.whatsAppMessage.update({
      where: { id },
      data: {
        status: out.status,
        lastError: out.error ?? null,
        preview: out.preview ?? undefined,
        providerId: out.providerId ?? undefined,
        sentAt: out.status === "SENT" ? now : undefined,
      },
    });
    results.push(out.status);
  }
  return results;
}

/** Owner's «إعادة المحاولة»: the same row goes back in the queue (never a second message, never a new door code). */
export async function retryMessage(db: PrismaClient, id: string) {
  const { count } = await db.whatsAppMessage.updateMany({
    where: { id, status: { in: ["FAILED", "BLOCKED", "SKIPPED", "DRY_RUN"] } },
    data: { status: "SCHEDULED", scheduledAt: new Date(), lastError: null },
  });
  return count === 1;
}

/** A sample of one message with made-up booking data, sent to a number the owner chooses (normally their own). */
export function sampleMessage(kind: WaKind, s: SettingValue<"whatsappAutomation">) {
  const vars: Record<string, string> = {
    customer_name: "محمد",
    booking_reference: "JD-000000",
    booking_date: "الخميس، 1 يناير 2026",
    booking_items: "الاستراحة كاملة",
    booking_amount: "1,200 ريال",
    amount_due_now: "1,100 ريال",
    remaining_amount: "600 ريال",
    security_deposit: "500 ريال",
    deposit_remaining: "0 ريال",
    payment_instructions: "تحويل بنكي — (تجربة)",
    payment_status_note: "رسالة تجريبية.",
    balance_due_by: "الأربعاء 2:00 م",
    check_in_time: "2:00 ظهرًا",
    check_out_time: "4:00 فجرًا",
    door_code: "000000",
    wifi_name: "ALJOOD",
    wifi_password: "—",
    arrival_instructions: "",
    location_url: "—",
  };
  const cfg = s.messages[kind];
  return { cfg, ...render(cfg.text, vars), title: DEFAULT_WA_MESSAGES[kind].title };
}

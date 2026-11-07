import { Prisma, type BookingChannel, type BookingStatus, type DepositTiming, type PaymentMethod, type PaymentPlan, type PaymentPurpose, type PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { HttpError } from "../lib/http.js";
import { addDays, eachDate, fromIsoDate, todayInRiyadh, toIsoDate } from "../lib/dates.js";
import { audit } from "../lib/audit.js";
import { formatDateAr } from "../lib/format.js";
import { getSetting } from "../settings/registry.js";
import { quote, type Quote } from "./pricing.js";
import { blockedResources, lockKeysByResource, resourcesCompatible } from "./conflicts.js";
import { notifyOwner, type WhatsAppSender } from "./notifications.js";
import type { SecretBox } from "../lib/secretBox.js";
import { computeDiscount, findCode, redeem, type AppliedDiscount } from "./discounts.js";
import { paymentSummary, upfrontFor } from "./payments.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const ACTIVE_STATUSES: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"];

/** Allowed admin status changes. Confirmation additionally needs accepted payments covering the total. */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  NEW: ["AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "CANCELLED"],
  AWAITING_PAYMENT: ["AWAITING_VERIFICATION", "CONFIRMED", "CANCELLED"],
  AWAITING_VERIFICATION: ["CONFIRMED", "AWAITING_PAYMENT", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED"],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  COMPLETED: [],
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  NEW: "طلب جديد",
  AWAITING_PAYMENT: "بانتظار الدفع",
  AWAITING_VERIFICATION: "بانتظار التحقق",
  CONFIRMED: "مؤكد",
  CANCELLED: "ملغي",
  REJECTED: "مرفوض",
  EXPIRED: "منتهي",
  COMPLETED: "مكتمل",
};

export interface Selection {
  resourceIds: string[];
  startDate: string;
  nights: number;
}

export interface Evaluation {
  dates: string[];
  endDate: string;
  resources: { id: string; name: string; kind: "FULL" | "PART" }[];
  quote: Quote;
  deposit: number;
}

/**
 * Validates a selection against the owner's rules and current bookings, and prices it.
 * Throws HttpError with an Arabic reason when it cannot be booked. Used for quotes, for
 * creating a booking (inside its transaction) and never trusts anything from the browser.
 */
export async function evaluateSelection(db: Db, sel: Selection, opts: { channel: BookingChannel }): Promise<Evaluation> {
  const policy = await getSetting(db, "bookingPolicy");
  const ids = [...new Set(sel.resourceIds)];
  if (ids.length === 0) throw new HttpError(400, "اختر ما تريد حجزه");
  if (!Number.isInteger(sel.nights) || sel.nights < 1 || sel.nights > policy.maxNights) {
    throw new HttpError(400, `عدد الأيام من 1 إلى ${policy.maxNights}`);
  }

  const today = todayInRiyadh();
  if (sel.startDate < today) throw new HttpError(400, "لا يمكن الحجز في تاريخ سابق");
  if (opts.channel === "WEBSITE" && sel.startDate > addDays(today, policy.maxAdvanceDays)) {
    throw new HttpError(400, `يمكن الحجز حتى ${policy.maxAdvanceDays} يومًا مقدمًا`);
  }

  const resources = await db.bookingResource.findMany({
    where: { id: { in: ids } },
    include: { amenities: { include: { amenity: { select: { name: true, available: true } } } } },
  });
  if (resources.length !== ids.length || resources.some((r) => !r.active)) {
    throw new HttpError(400, "بعض ما اخترته غير متاح للحجز");
  }
  if (resources.some((r) => r.kind === "FULL") && resources.length > 1) {
    throw new HttpError(400, "الاستراحة كاملة تشمل كل الأجزاء؛ لا تحتاج إلى اختيار أجزاء معها");
  }
  for (const r of resources) {
    const off = r.kind === "PART" ? r.amenities.find((a) => !a.amenity.available) : undefined;
    if (off) throw new HttpError(400, `${r.name} غير متاح حاليًا (${off.amenity.name})`);
  }
  if (!(await resourcesCompatible(db, ids))) throw new HttpError(400, "الأجزاء المختارة لا يمكن حجزها معًا");

  const dates = eachDate(sel.startDate, addDays(sel.startDate, sel.nights));
  const q = await quote(db, ids, dates);
  if (q.missing.length > 0) {
    const m = q.missing[0]!;
    throw new HttpError(400, `${m.resourceName} غير متاح للحجز يوم ${formatDateAr(m.date)}`);
  }

  const blocked = await blockedResources(db, ids, dates);
  if (blocked.size > 0) {
    const [resourceId, days] = [...blocked.entries()][0]!;
    const name = resources.find((r) => r.id === resourceId)?.name ?? "";
    throw new HttpError(409, `${name} محجوز يوم ${formatDateAr([...days].sort()[0]!)}`);
  }

  return {
    dates,
    endDate: addDays(sel.startDate, sel.nights),
    resources: resources.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    quote: q,
    deposit: policy.securityDeposit,
  };
}

export interface NewBooking extends Selection {
  guest: { name: string; phone: string; email?: string | null; nationalId?: string | null };
  guestCount?: number | null;
  guestNotes?: string | null;
  adminNotes?: string | null;
  channel: BookingChannel;
  /** كود الخصم كما أدخله الضيف (مُطبّع) — يُتحقق منه ويُحسب في الخادم */
  discountCode?: string | null;
  /** كامل المبلغ أو عربون — الافتراضي كامل المبلغ */
  paymentPlan?: PaymentPlan;
  /** متى يُدفع التأمين — الافتراضي مع الدفعة الأولى */
  depositTiming?: DepositTiming;
  /** للحجوزات اليدوية فقط: مبلغ تأمين مختلف (مثل 0 لحجز جاذر إن) */
  securityDeposit?: number | null;
}

async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_reference_seq') AS n`;
  return `JD-${String(row!.n).padStart(6, "0")}`;
}

/**
 * Creates a booking request. Everything happens in one transaction: re-validation, pricing,
 * guest record, booking, items and the lock rows. If another request took any of the same
 * (amenity, day) slots first, the lock insert fails on its primary key and nothing is saved.
 */
export async function createBooking(
  db: PrismaClient,
  input: NewBooking,
  ctx: { req?: Request; whatsapp: WhatsAppSender | null; secretBox: SecretBox },
) {
  await expireStaleBookings(db);

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const ev = await evaluateSelection(tx, input, { channel: input.channel });
      // The ID number is personal data: stored encrypted, with only the last 4 digits in clear for lists.
      const id = input.guest.nationalId
        ? { nationalIdEnc: ctx.secretBox.seal(input.guest.nationalId), nationalIdLast4: input.guest.nationalId.slice(-4) }
        : {};
      const guest = await tx.guest.upsert({
        where: { phone: input.guest.phone },
        create: { name: input.guest.name, phone: input.guest.phone, email: input.guest.email ?? null, ...id },
        update: { name: input.guest.name, ...(input.guest.email ? { email: input.guest.email } : {}), ...id },
      });

      const discount: AppliedDiscount | null = input.discountCode
        ? computeDiscount(await findCode(tx, input.discountCode), {
            lines: ev.quote.lines,
            subtotal: new Prisma.Decimal(ev.quote.total),
            resourceKinds: ev.resources.map((r) => r.kind),
          })
        : null;

      const policy = await getSetting(tx, "bookingPolicy");
      const plan: PaymentPlan = input.paymentPlan ?? "FULL";
      if (plan === "DEPOSIT" && input.channel === "WEBSITE" && !policy.allowDepositPlan) {
        throw new HttpError(400, "خيار العربون غير متاح حاليًا");
      }
      const bookingTotal = discount ? discount.total : ev.quote.total;
      // The deposit percentage applies to the booking amount after any discount; the security deposit is separate.
      const upfront = upfrontFor(plan, bookingTotal, policy.depositPercent);
      const securityDeposit = input.channel !== "WEBSITE" && input.securityDeposit != null ? input.securityDeposit : ev.deposit;

      const booking = await tx.booking.create({
        data: {
          reference: await nextReference(tx),
          guestId: guest.id,
          channel: input.channel,
          startDate: fromIsoDate(input.startDate),
          endDate: fromIsoDate(ev.endDate),
          totalAmount: discount ? discount.total : ev.quote.total,
          discountAmount: discount ? discount.amount : 0,
          discountCode: discount?.code ?? null,
          depositAmount: securityDeposit,
          paymentPlan: plan,
          upfrontAmount: upfront,
          depositTiming: input.depositTiming ?? "WITH_FIRST_PAYMENT",
          priceBreakdown: ev.quote.lines as unknown as Prisma.InputJsonValue,
          guestCount: input.guestCount ?? null,
          guestNotes: input.guestNotes ?? null,
          adminNotes: input.adminNotes ?? null,
        },
      });

      if (discount) await redeem(tx, discount, booking.id, guest.id);

      await tx.bookingItem.createMany({
        data: ev.quote.lines.map((l) => ({ bookingId: booking.id, resourceId: l.resourceId, date: fromIsoDate(l.date), price: l.price })),
      });

      const keys = [...new Set([...(await lockKeysByResource(tx, input.resourceIds)).values()].flat())];
      await tx.bookingLock.createMany({
        data: keys.flatMap((key) => ev.dates.map((d) => ({ key, date: fromIsoDate(d), bookingId: booking.id }))),
      });

      if (ctx.req?.user) {
        await audit(tx, ctx.req, {
          action: "booking.create",
          entityType: "booking",
          entityId: booking.id,
          details: { reference: booking.reference, channel: input.channel },
        });
      }
      return { booking, guest, ev, discount };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      if (JSON.stringify(err.meta ?? {}).includes("discount") || err.message.includes("discount_redemptions")) {
        throw new HttpError(400, "استخدمت كود الخصم هذا من قبل");
      }
      throw new HttpError(409, "عذرًا، حُجز هذا الموعد للتو. اختر تاريخًا آخر.");
    }
    throw err;
  }

  const { booking, guest, ev, discount } = created;
  const what = ev.resources.map((r) => r.name).join("، ");
  const when = ev.dates.length === 1 ? formatDateAr(ev.dates[0]!) : `${formatDateAr(ev.dates[0]!)} (${ev.dates.length} أيام)`;
  if (input.channel === "WEBSITE") {
    await notifyOwner(
      db,
      {
        type: "NEW_BOOKING",
        title: `طلب حجز جديد ${booking.reference}`,
        body: `${guest.name} — ${guest.phone}\n${what}\n${when}\nالمبلغ: ${booking.totalAmount.toFixed(2)} ريال${discount ? ` (بعد خصم ${discount.amount} بكود ${discount.code})` : ""}`,
        bookingId: booking.id,
        whatsappParams: [booking.reference, guest.name, guest.phone, when, what],
      },
      ctx.whatsapp,
    );
  }
  return { booking, guest, evaluation: ev, discount };
}

/** Moves unpaid requests past their payment deadline to EXPIRED (a trigger releases their days). */
export async function expireStaleBookings(db: Db) {
  const { count } = await db.booking.updateMany({
    where: { status: "AWAITING_PAYMENT", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return count;
}

async function lockBooking(tx: Prisma.TransactionClient, id: string) {
  // Row lock: concurrent admin actions on the same booking run one after another.
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "الحجز غير موجود");
  return tx.booking.findUniqueOrThrow({
    where: { id },
    include: { items: true, payments: true, locks: { select: { key: true } } },
  });
}

/** Verified booking money received, net of refunds. The security deposit is never counted here. */
export function acceptedPaid(payments: { status: string; amount: Prisma.Decimal; purpose?: string; kind?: string }[]) {
  return payments
    .filter((p) => p.status === "ACCEPTED" && (p.purpose ?? "BOOKING") === "BOOKING")
    .reduce((s, p) => (p.kind === "REFUND" ? s.sub(p.amount) : s.add(p.amount)), new Prisma.Decimal(0));
}

export async function changeStatus(db: PrismaClient, req: Request, id: string, to: BookingStatus, reason?: string | null) {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, id);
    if (!TRANSITIONS[b.status].includes(to)) {
      throw new HttpError(409, `لا يمكن تغيير الحالة من «${STATUS_LABELS[b.status]}» إلى «${STATUS_LABELS[to]}»`);
    }

    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === "CONFIRMED") {
      // Never confirm on a request or an uploaded receipt alone: the owner must have verified the money arrived.
      // Full plan: the whole booking amount. Deposit plan: the agreed up-front part. Plus the security
      // deposit when the guest chose to pay it with the first payment.
      const sum = paymentSummary(b);
      if (!sum.canConfirm) {
        const parts = [`المطلوب للتأكيد ${sum.dueToConfirm} ريال`];
        if (Number(sum.upfrontRemaining) > 0) parts.push(`من مبلغ الحجز ${sum.upfrontRemaining}`);
        if (!b.legacyPayment && b.depositTiming === "WITH_FIRST_PAYMENT" && Number(sum.depositRemaining) > 0) parts.push(`ومن التأمين ${sum.depositRemaining}`);
        throw new HttpError(409, `لا يمكن التأكيد قبل تسجيل دفع متحقق منه. ${parts.join(" ")}.`);
      }
      // Re-verify availability at confirmation: every slot must still be held by this booking.
      const resourceIds = [...new Set(b.items.map((i) => i.resourceId))];
      const dates = [...new Set(b.items.map((i) => toIsoDate(i.date)))];
      const keys = new Set([...(await lockKeysByResource(tx, resourceIds)).values()].flat());
      if (b.locks.length < keys.size * dates.length) {
        throw new HttpError(409, "تغيّرت إعدادات الأجزاء منذ الطلب؛ راجع الإتاحة قبل التأكيد");
      }
      data.confirmedAt = new Date();
      data.confirmedBy = { connect: { id: req.user!.id } };
      data.expiresAt = null;
    } else if (to === "AWAITING_PAYMENT") {
      const policy = await getSetting(tx, "bookingPolicy");
      data.expiresAt = policy.unpaidExpiryHours ? new Date(Date.now() + policy.unpaidExpiryHours * 3600_000) : null;
    } else if (to === "CANCELLED" || to === "REJECTED") {
      data.cancelledAt = new Date();
      data.cancelReason = reason ?? null;
      data.expiresAt = null;
      // A cancelled booking's guest link stops working immediately.
      await tx.guestAccessToken.updateMany({ where: { bookingId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    } else if (to === "COMPLETED") {
      if (toIsoDate(b.endDate) > addDays(todayInRiyadh(), 1)) throw new HttpError(409, "لا يكتمل الحجز قبل انتهاء موعده");
    } else if (to === "AWAITING_VERIFICATION") {
      data.expiresAt = null;
    }

    const updated = await tx.booking.update({ where: { id }, data });
    await audit(tx, req, {
      action: "booking.status",
      entityType: "booking",
      entityId: id,
      details: { from: b.status, to, reason: reason ?? undefined },
    });
    return updated;
  });
}

export interface PaymentInput {
  method: PaymentMethod;
  /** مبلغ الحجز أو التأمين — الافتراضي مبلغ الحجز */
  purpose?: PaymentPurpose;
  amount: number;
  reportedAt?: string | null;
  externalRef?: string | null;
  note?: string | null;
}

/**
 * Records a payment the admin has verified (money actually received). Recorded manually for both
 * bank transfers and Gathern; no platform fee is ever added or assumed.
 */
export async function recordVerifiedPayment(db: PrismaClient, req: Request, bookingId: string, p: PaymentInput) {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    if (!ACTIVE_STATUSES.includes(b.status)) throw new HttpError(409, `لا يمكن تسجيل دفع لحجز «${STATUS_LABELS[b.status]}»`);
    const purpose = p.purpose ?? "BOOKING";
    // Guard against typing mistakes: never record more than what is still owed for that purpose.
    const sum = paymentSummary(b);
    const left = new Prisma.Decimal(purpose === "BOOKING" ? sum.bookingRemaining : sum.depositRemaining);
    if (left.lessThan(p.amount)) {
      throw new HttpError(400, `المبلغ أكبر من المتبقي ${purpose === "BOOKING" ? "من مبلغ الحجز" : "من التأمين"} (${left.toFixed(2)} ريال)`);
    }
    const payment = await tx.payment.create({
      data: {
        bookingId,
        purpose,
        method: p.method,
        amount: p.amount,
        status: "ACCEPTED",
        reportedAt: p.reportedAt ? new Date(p.reportedAt) : null,
        externalRef: p.externalRef ?? null,
        note: p.note ?? null,
        verifiedAt: new Date(),
        verifiedById: req.user!.id,
      },
    });
    await audit(tx, req, {
      action: "payment.verified",
      entityType: "payment",
      entityId: payment.id,
      details: { bookingId, purpose, method: p.method, amount: p.amount, externalRef: p.externalRef ?? undefined },
    });
    return payment;
  });
}

/**
 * Records money returned to the guest (e.g. the security deposit after departure, or the booking amount
 * after a cancellation 72+ hours ahead). A refund is a new record: payments are never edited or deleted.
 */
export async function recordRefund(
  db: PrismaClient,
  req: Request,
  bookingId: string,
  r: { purpose: PaymentPurpose; method: PaymentMethod; amount: number; note?: string | null },
) {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const sum = paymentSummary(b);
    const refundable = new Prisma.Decimal(r.purpose === "BOOKING" ? sum.bookingPaid : sum.depositPaid).sub(
      r.purpose === "BOOKING" ? 0 : sum.depositRefunded,
    );
    if (refundable.lessThan(r.amount)) {
      throw new HttpError(400, `مبلغ الاسترداد أكبر من المدفوع ${r.purpose === "BOOKING" ? "من مبلغ الحجز" : "من التأمين"} (${refundable.toFixed(2)} ريال)`);
    }
    const refund = await tx.payment.create({
      data: {
        bookingId,
        purpose: r.purpose,
        kind: "REFUND",
        method: r.method,
        amount: r.amount,
        status: "ACCEPTED",
        note: r.note ?? null,
        verifiedAt: new Date(),
        verifiedById: req.user!.id,
      },
    });
    await audit(tx, req, {
      action: "payment.refund",
      entityType: "payment",
      entityId: refund.id,
      details: { bookingId, purpose: r.purpose, method: r.method, amount: r.amount },
    });
    return refund;
  });
}

/**
 * Once per booking: when the balance deadline (N hours before check-in) has passed and the booking
 * or the deposit is still not fully paid, the owner is alerted and decides what to do. Nothing is
 * cancelled automatically. Safe to run repeatedly and from several places (the flag is set atomically).
 */
export async function alertUnpaidBalances(db: PrismaClient, whatsapp: WhatsAppSender | null, now = new Date()) {
  const [policy, stay] = await Promise.all([getSetting(db, "bookingPolicy"), getSetting(db, "stay")]);
  const horizon = addDays(todayInRiyadh(), Math.ceil(policy.balanceDueHours / 24) + 1);
  const candidates = await db.booking.findMany({
    where: { status: "CONFIRMED", legacyPayment: false, balanceAlertAt: null, startDate: { lte: fromIsoDate(horizon) } },
    include: { payments: true, guest: { select: { name: true, phone: true } } },
  });
  let sent = 0;
  for (const b of candidates) {
    const sum = paymentSummary(b, { checkIn: stay.checkIn, balanceDueHours: policy.balanceDueHours });
    if (sum.fullySettled || !sum.balanceDueAt || sum.balanceDueAt > now) continue;
    // Claim the alert first, so two runs never send it twice.
    const { count } = await db.booking.updateMany({ where: { id: b.id, balanceAlertAt: null }, data: { balanceAlertAt: now } });
    if (count === 0) continue;
    const missing = [
      Number(sum.bookingRemaining) > 0 ? `المتبقي من مبلغ الحجز: ${sum.bookingRemaining} ريال` : null,
      Number(sum.depositRemaining) > 0 ? `التأمين غير مسدد: ${sum.depositRemaining} ريال` : null,
    ].filter(Boolean) as string[];
    await notifyOwner(
      db,
      {
        type: "PAYMENT_DUE",
        title: `لم يكتمل السداد ${b.reference}`,
        body: `${b.guest.name} — ${b.guest.phone}\nالدخول: ${formatDateAr(toIsoDate(b.startDate))}\n${missing.join("\n")}\nرمز الباب لن يظهر للضيف حتى يكتمل السداد.`,
        bookingId: b.id,
        whatsappParams: [b.reference, b.guest.name, b.guest.phone, formatDateAr(toIsoDate(b.startDate)), missing.join("، ")],
      },
      whatsapp,
    );
    sent++;
  }
  return sent;
}

export async function rejectPayment(db: PrismaClient, req: Request, paymentId: string, note: string | null) {
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new HttpError(404, "الدفعة غير موجودة");
    if (p.status !== "PENDING") throw new HttpError(409, "تمت مراجعة هذه الدفعة مسبقًا");
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "REJECTED", verifiedAt: new Date(), verifiedById: req.user!.id, note },
    });
    await audit(tx, req, { action: "payment.rejected", entityType: "payment", entityId: paymentId, details: { note } });
    return updated;
  });
}

export async function acceptPendingPayment(db: PrismaClient, req: Request, paymentId: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new HttpError(404, "الدفعة غير موجودة");
    if (p.status !== "PENDING") throw new HttpError(409, "تمت مراجعة هذه الدفعة مسبقًا");
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "ACCEPTED", verifiedAt: new Date(), verifiedById: req.user!.id },
    });
    await audit(tx, req, { action: "payment.verified", entityType: "payment", entityId: paymentId });
    return updated;
  });
}

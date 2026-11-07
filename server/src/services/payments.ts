import { Prisma, type DepositTiming, type PaymentPlan } from "@prisma/client";
import { checkinInstant } from "./doorCodes.js";

type Money = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** The booking part the guest pays up front for each plan (after any discount). Deposit is separate. */
export function upfrontFor(plan: PaymentPlan, bookingTotal: Prisma.Decimal.Value, depositPercent: number): Money {
  const total = D(bookingTotal);
  if (plan === "FULL") return total;
  return total.mul(depositPercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

interface PaymentRow {
  purpose: "BOOKING" | "SECURITY_DEPOSIT";
  kind: "PAYMENT" | "REFUND";
  status: string;
  amount: Prisma.Decimal;
}

interface BookingMoney {
  totalAmount: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  upfrontAmount: Prisma.Decimal;
  paymentPlan: PaymentPlan;
  depositTiming: DepositTiming;
  legacyPayment: boolean;
  startDate: Date;
  payments: PaymentRow[];
}

export type DepositStatus = "NONE" | "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED";

/**
 * Everything about a booking's money, from verified (ACCEPTED) records only. Booking money and the
 * security deposit are kept apart and never mixed. Used for confirmation, the guest portal, alerts
 * and the admin panel — one place, so they always agree.
 */
export function paymentSummary(b: BookingMoney, opts: { checkIn?: string; balanceDueHours?: number } = {}) {
  const sum = (purpose: PaymentRow["purpose"], kind: PaymentRow["kind"]) =>
    b.payments.filter((p) => p.status === "ACCEPTED" && p.purpose === purpose && p.kind === kind).reduce((s, p) => s.add(p.amount), D(0));

  const bookingPaid = sum("BOOKING", "PAYMENT");
  const bookingRefunded = sum("BOOKING", "REFUND");
  const depositPaid = sum("SECURITY_DEPOSIT", "PAYMENT");
  const depositRefunded = sum("SECURITY_DEPOSIT", "REFUND");
  const bookingNet = bookingPaid.sub(bookingRefunded);
  const total = b.totalAmount;
  const deposit = b.depositAmount;

  const bookingRemaining = Prisma.Decimal.max(total.sub(bookingNet), 0);
  const depositRemaining = Prisma.Decimal.max(deposit.sub(depositPaid), 0);
  const upfrontRemaining = Prisma.Decimal.max(b.upfrontAmount.sub(bookingNet), 0);

  // Confirmation: the up-front booking part, plus the deposit when the guest chose to pay it with it.
  // Bookings made before this system keep the old rule (full booking amount, deposit not tracked).
  const depositNeededToConfirm = !b.legacyPayment && b.depositTiming === "WITH_FIRST_PAYMENT";
  const canConfirm = b.legacyPayment
    ? bookingNet.greaterThanOrEqualTo(total)
    : upfrontRemaining.isZero() && (!depositNeededToConfirm || depositRemaining.isZero());

  // Fully settled = the whole booking amount and the whole deposit are verified. Door codes wait for this.
  const fullySettled = b.legacyPayment ? bookingNet.greaterThanOrEqualTo(total) : bookingRemaining.isZero() && depositRemaining.isZero();

  let depositStatus: DepositStatus;
  if (deposit.isZero()) depositStatus = "NONE";
  else if (depositRefunded.greaterThan(0)) depositStatus = depositRefunded.greaterThanOrEqualTo(depositPaid) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  else if (depositPaid.isZero()) depositStatus = "UNPAID";
  else depositStatus = depositRemaining.isZero() ? "PAID" : "PARTIAL";

  const balanceDueAt =
    opts.checkIn && opts.balanceDueHours !== undefined
      ? new Date(checkinInstant(b.startDate, opts.checkIn).getTime() - opts.balanceDueHours * 3600_000)
      : null;

  return {
    plan: b.paymentPlan,
    depositTiming: b.depositTiming,
    legacy: b.legacyPayment,
    bookingTotal: total.toFixed(2),
    upfrontAmount: b.upfrontAmount.toFixed(2),
    bookingPaid: bookingNet.toFixed(2),
    bookingRefunded: bookingRefunded.toFixed(2),
    bookingRemaining: bookingRemaining.toFixed(2),
    upfrontRemaining: upfrontRemaining.toFixed(2),
    securityDeposit: deposit.toFixed(2),
    depositPaid: depositPaid.toFixed(2),
    depositRefunded: depositRefunded.toFixed(2),
    depositRemaining: depositRemaining.toFixed(2),
    depositStatus,
    /** What the guest still has to pay before confirmation (booking part + deposit if chosen). */
    dueToConfirm: upfrontRemaining.add(depositNeededToConfirm ? depositRemaining : 0).toFixed(2),
    canConfirm,
    fullySettled,
    balanceDueAt,
  };
}

export type PaymentSummary = ReturnType<typeof paymentSummary>;

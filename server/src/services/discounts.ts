import { Prisma, type DiscountCode, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../lib/http.js";
import { dayOfWeek, toIsoDate, todayInRiyadh } from "../lib/dates.js";
import { asciiDigits } from "../settings/registry.js";
import type { QuoteLine } from "./pricing.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Codes are typed by guests: trimmed, upper-cased, Arabic digits accepted. */
export const discountCodeSchema = z
  .string()
  .transform((v) => asciiDigits(v).trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, "كود الخصم بأحرف إنجليزية وأرقام (3 إلى 30)"));

export interface AppliedDiscount {
  codeId: string;
  code: string;
  /** مبلغ الحجز قبل الخصم */
  subtotal: string;
  /** الأيام المشمولة بالخصم من مبلغ الحجز */
  eligibleSubtotal: string;
  amount: string;
  /** مبلغ الحجز بعد الخصم (التأمين منفصل ولا يدخل في الخصم) */
  total: string;
  onePerGuest: boolean;
}

const NOT_VALID = "كود الخصم غير صحيح أو غير مفعّل";

/**
 * Works out the discount of `code` on a priced selection. Everything is computed here, on the server,
 * from the stored code and the server's own prices — nothing from the browser is trusted.
 * Throws HttpError(400) with the reason when the code cannot be used.
 * The usage limit is checked here for a friendly message, and enforced atomically in `redeem`.
 */
export function computeDiscount(
  code: DiscountCode | null,
  ctx: { lines: QuoteLine[]; subtotal: Prisma.Decimal; resourceKinds: ("FULL" | "PART")[]; today?: string },
): AppliedDiscount {
  if (!code || !code.active) throw new HttpError(400, NOT_VALID);
  const today = ctx.today ?? todayInRiyadh();
  if (code.startDate && today < toIsoDate(code.startDate)) throw new HttpError(400, "كود الخصم لم تبدأ صلاحيته بعد");
  if (code.endDate && today > toIsoDate(code.endDate)) throw new HttpError(400, "انتهت صلاحية كود الخصم");
  if (code.maxUses !== null && code.usedCount >= code.maxUses) throw new HttpError(400, "انتهت الاستخدامات المتاحة لكود الخصم");
  if (code.scope === "FULL_ONLY" && ctx.resourceKinds.some((k) => k !== "FULL")) {
    throw new HttpError(400, "كود الخصم هذا للحجز الكامل للاستراحة فقط");
  }
  if (code.minAmount && ctx.subtotal.lessThan(code.minAmount)) {
    throw new HttpError(400, `الحد الأدنى لاستخدام كود الخصم ${code.minAmount.toFixed(0)} ريال`);
  }

  const eligible = ctx.lines.filter(
    (l) =>
      (code.daysOfWeek.length === 0 || code.daysOfWeek.includes(dayOfWeek(l.date))) &&
      (code.includeSpecialDays || l.ruleKind === "WEEKDAY"),
  );
  if (eligible.length === 0) throw new HttpError(400, "كود الخصم لا ينطبق على الأيام المختارة");
  const eligibleSubtotal = eligible.reduce((s, l) => s.add(l.price), new Prisma.Decimal(0));

  let amount =
    code.type === "PERCENT"
      ? eligibleSubtotal.mul(code.value).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : Prisma.Decimal.min(code.value, eligibleSubtotal);
  if (amount.greaterThan(ctx.subtotal)) amount = ctx.subtotal;

  return {
    codeId: code.id,
    code: code.code,
    subtotal: ctx.subtotal.toFixed(2),
    eligibleSubtotal: eligibleSubtotal.toFixed(2),
    amount: amount.toFixed(2),
    total: ctx.subtotal.sub(amount).toFixed(2),
    onePerGuest: code.onePerGuest,
  };
}

export async function findCode(db: Db, code: string) {
  return db.discountCode.findUnique({ where: { code } });
}

/**
 * Records one use of the code for a booking, inside the booking's transaction.
 * The counter only moves if the code is still active and under its limit (row-locked UPDATE), so
 * two guests can never both take the last use. "Once per guest" is backed by a unique index.
 */
export async function redeem(tx: Prisma.TransactionClient, d: AppliedDiscount, bookingId: string, guestId: string) {
  if (d.onePerGuest) {
    const used = await tx.discountRedemption.findFirst({ where: { codeId: d.codeId, guestId, status: "ACTIVE" } });
    if (used) throw new HttpError(400, "استخدمت كود الخصم هذا من قبل");
  }
  const n = await tx.$executeRaw`
    UPDATE "discount_codes" SET "used_count" = "used_count" + 1, "updated_at" = now()
    WHERE "id" = ${d.codeId}::uuid AND "active" AND ("max_uses" IS NULL OR "used_count" < "max_uses")`;
  if (n !== 1) throw new HttpError(400, "انتهت الاستخدامات المتاحة لكود الخصم");
  await tx.discountRedemption.create({
    data: { codeId: d.codeId, bookingId, guestId, amount: d.amount, onePerGuest: d.onePerGuest },
  });
}

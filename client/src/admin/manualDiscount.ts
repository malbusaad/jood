export type DiscountType = "FIXED" | "PERCENT" | "FINAL_PRICE";

export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export const DISCOUNT_LABEL: Record<DiscountType, string> = { FIXED: "مبلغ ثابت", PERCENT: "نسبة مئوية", FINAL_PRICE: "سعر نهائي متفق عليه" };

/**
 * Preview of a manual discount — mirrors manualDiscountAmount() on the server, which has the final say.
 * Returns the discount, its share of the base and the final price, or an error message.
 */
export function previewDiscount(base: number, type: DiscountType, raw: string): { amount: number; percent: number; final: number } | { error: string } | null {
  if (raw.trim() === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return { error: "أدخل رقمًا صحيحًا" };
  let amount: number;
  if (type === "FIXED") amount = v;
  else if (type === "PERCENT") {
    if (v > 100) return { error: "النسبة لا تتجاوز 100%" };
    amount = r2((base * v) / 100);
  } else {
    if (v > base) return { error: "السعر النهائي أعلى من السعر الأساسي" };
    amount = r2(base - v);
  }
  if (amount > base) return { error: "الخصم أكبر من السعر الأساسي" };
  return { amount, percent: base > 0 ? r2((amount / base) * 100) : 0, final: r2(base - amount) };
}

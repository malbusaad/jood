import type { SiteContent } from "../content/site";

/** الخميس (4) والجمعة (5) والسبت (6) */
export function isThuToSat(date: Date): boolean {
  const d = date.getDay();
  return d >= 4;
}

/**
 * السعر الأساسي لحجز الاستراحة كاملة في تاريخ معين، للعرض فقط.
 * السعر النهائي (المواسم والتواريخ الخاصة) يحسبه الخادم عند الحجز.
 */
export function baseFullRestPrice(date: Date, prices: SiteContent["fullRestPrices"]): number {
  return isThuToSat(date) ? prices.thuToSat : prices.sunToWed;
}

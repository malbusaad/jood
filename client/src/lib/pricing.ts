export const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;

export interface PriceGroup {
  label: string;
  price: number;
  days: number[];
}

/**
 * Groups consecutive weekdays (Sunday→Saturday) that share the same price, e.g.
 * [950,950,950,950,1200,1200,1200] → «الأحد إلى الأربعاء: 950», «الخميس إلى السبت: 1200».
 * Days without an approved price (null) are left out.
 */
export function groupWeekdayPrices(prices: (number | null)[]): PriceGroup[] {
  const groups: PriceGroup[] = [];
  prices.forEach((price, day) => {
    if (price === null || price === undefined) return;
    const last = groups.at(-1);
    if (last && last.price === price && last.days.at(-1) === day - 1) last.days.push(day);
    else groups.push({ label: "", price, days: [day] });
  });
  for (const g of groups) {
    const first = DAY_NAMES[g.days[0]!]!;
    const end = DAY_NAMES[g.days.at(-1)!]!;
    g.label = g.days.length === 1 ? first : `${first} إلى ${end}`;
  }
  return groups;
}

export const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;

export interface PriceGroup {
  label: string;
  price: number;
  days: number[];
}

/**
 * Groups the weekdays (Sunday→Saturday) that share a price, even when they are not next to each other:
 * [950,950,950,950,1100,1200,1100] → «الأحد إلى الأربعاء: 950», «الخميس والسبت: 1100», «الجمعة: 1200».
 * Consecutive days read as a range («الأحد إلى الأربعاء»); separate ones are joined with «و».
 * Groups keep the order of their first day. Days without an approved price (null) are left out.
 */
export function groupWeekdayPrices(prices: (number | null)[]): PriceGroup[] {
  const groups: PriceGroup[] = [];
  prices.forEach((price, day) => {
    if (price === null || price === undefined) return;
    const same = groups.find((g) => g.price === price);
    if (same) same.days.push(day);
    else groups.push({ label: "", price, days: [day] });
  });
  for (const g of groups) {
    const runs: number[][] = [];
    for (const d of g.days) {
      const run = runs.at(-1);
      if (run && run.at(-1) === d - 1) run.push(d);
      else runs.push([d]);
    }
    const parts = runs.map((r) => (r.length === 1 ? DAY_NAMES[r[0]!]! : `${DAY_NAMES[r[0]!]!} إلى ${DAY_NAMES[r.at(-1)!]!}`));
    g.label = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join("، ")} و${parts.at(-1)!}`;
  }
  return groups;
}

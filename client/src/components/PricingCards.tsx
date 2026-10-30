import { Moon, Sun } from "lucide-react";
import PendingNotice from "./PendingNotice";
import { groupWeekdayPrices } from "../lib/pricing";

const numberFmt = new Intl.NumberFormat("en-US");

export default function PricingCards({ weekdayPrices }: { weekdayPrices: (number | null)[] }) {
  const groups = groupWeekdayPrices(weekdayPrices);
  if (groups.length === 0) return <PendingNotice>الأسعار قيد التحديث.</PendingNotice>;
  const top = Math.max(...groups.map((g) => g.price));

  return (
    <div className={`grid gap-5 ${groups.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {groups.map(({ label, price }, i) => {
        const featured = groups.length > 1 && price === top;
        const Icon = i === 0 ? Sun : Moon;
        return (
          <div
            key={label}
            className={`relative overflow-hidden rounded-3xl p-8 ${
              featured
                ? "bg-jood-green text-jood-beige shadow-xl shadow-jood-green/20"
                : "border border-jood-green/15 bg-white/80 text-jood-ink"
            }`}
          >
            <Icon aria-hidden className="size-7 text-jood-gold" strokeWidth={1.25} />
            <p className={`mt-6 text-sm ${featured ? "text-jood-beige/70" : "text-jood-ink/60"}`}>حجز الاستراحة كاملة</p>
            <h3 className="mt-1 font-display text-xl font-semibold">{label}</h3>
            <p className="mt-6 flex items-baseline gap-2">
              <span className={`font-display text-5xl font-semibold ${featured ? "text-jood-gold" : "text-jood-green"}`}>
                {numberFmt.format(price)}
              </span>
              <span className="text-sm">ريال / اليوم</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

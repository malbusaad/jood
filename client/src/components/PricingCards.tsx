import { Moon, Sun } from "lucide-react";
import { formatSAR } from "../lib/format";
import type { SiteContent } from "../content/site";

export default function PricingCards({ prices }: { prices: SiteContent["fullRestPrices"] }) {
  const cards = [
    { label: "الأحد إلى الأربعاء", price: prices.sunToWed, Icon: Sun, featured: false },
    { label: "الخميس إلى السبت", price: prices.thuToSat, Icon: Moon, featured: true },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cards.map(({ label, price, Icon, featured }) => (
        <div
          key={label}
          className={`relative overflow-hidden rounded-3xl p-8 ${
            featured
              ? "bg-jood-green text-jood-beige shadow-xl shadow-jood-green/20"
              : "border border-jood-green/15 bg-white/80 text-jood-ink"
          }`}
        >
          <Icon aria-hidden className="size-7 text-jood-gold" strokeWidth={1.25} />
          <p className={`mt-6 text-sm ${featured ? "text-jood-beige/70" : "text-jood-ink/60"}`}>
            حجز الاستراحة كاملة
          </p>
          <h3 className="mt-1 font-display text-xl font-semibold">{label}</h3>
          <p className="mt-6 flex items-baseline gap-2">
            <span className={`font-display text-5xl font-semibold ${featured ? "text-jood-gold" : "text-jood-green"}`}>
              {formatSAR(price).replace(" ريال", "")}
            </span>
            <span className="text-sm">ريال / اليوم</span>
          </p>
        </div>
      ))}
    </div>
  );
}

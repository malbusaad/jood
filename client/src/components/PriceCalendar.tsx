import { DayPicker, type DayProps } from "react-day-picker";
import { ar } from "react-day-picker/locale";
import "react-day-picker/style.css";
import type React from "react";
import { baseFullRestPrice, isThuToSat } from "../lib/pricing";
import type { SiteContent } from "../content/site";

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * تقويم يعرض السعر الأساسي لكل يوم.
 * لا يعرض الإتاحة بعد: الإتاحة الفعلية تأتي من نظام الحجوزات في المرحلة الرابعة.
 */
export default function PriceCalendar({ prices }: { prices: SiteContent["fullRestPrices"] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Display-only calendar: DayPicker renders plain cells (no buttons), so customise the cell itself.
  function PricedDay({ day, modifiers, children, ...props }: DayProps) {
    const showPrice = !modifiers.disabled && !modifiers.outside && !modifiers.hidden;
    return (
      <td {...(props as React.TdHTMLAttributes<HTMLTableCellElement>)}>
        {children && (
          <span className="jood-day">
            <span className="block leading-none">{children}</span>
            {showPrice && (
              <span className="mt-1 block text-[10px] leading-none opacity-70">
                {numberFmt.format(baseFullRestPrice(day.date, prices))}
              </span>
            )}
          </span>
        )}
      </td>
    );
  }

  return (
    <div className="jood-calendar overflow-x-auto rounded-3xl border border-jood-green/10 bg-white/80 p-4 sm:p-6">
      <DayPicker
        locale={ar}
        dir="rtl"
        numerals="latn"
        weekStartsOn={0}
        showOutsideDays={false}
        startMonth={new Date(today.getFullYear(), today.getMonth())}
        disabled={{ before: today }}
        modifiers={{ peak: (d: Date) => isThuToSat(d) }}
        modifiersClassNames={{ peak: "jood-peak" }}
        components={{ Day: PricedDay }}
      />
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-jood-ink/70">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full border border-jood-green/30 bg-white" />
          الأحد إلى الأربعاء: {numberFmt.format(prices.sunToWed)} ريال
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full bg-jood-gold/40" />
          الخميس إلى السبت: {numberFmt.format(prices.thuToSat)} ريال
        </span>
      </div>
    </div>
  );
}

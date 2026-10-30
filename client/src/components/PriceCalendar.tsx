import { useEffect, useState, type TdHTMLAttributes } from "react";
import { DayPicker, type DayProps } from "react-day-picker";
import { ar } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { api } from "../api/client";
import type { CalendarDay } from "../content/types";

const numberFmt = new Intl.NumberFormat("en-US");

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Calendar of the full rest house: real price and availability per day, from the server. */
export default function PriceCalendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [days, setDays] = useState<Map<string, CalendarDay>>(new Map());
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const from = iso(month);
    const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 1));
    setError(false);
    api<{ days: CalendarDay[] }>(`/api/public/calendar?from=${from}&to=${to}`)
      .then((res) => {
        if (!cancelled) setDays(new Map(res.days.map((d) => [d.date, d])));
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const info = (d: Date) => days.get(iso(d));
  const isPast = (d: Date) => d < today;

  // Display-only calendar: DayPicker renders plain cells (no buttons), so customise the cell itself.
  function PricedDay({ day, modifiers, children, ...props }: DayProps) {
    const d = info(day.date);
    const visible = !modifiers.hidden && !modifiers.outside && !isPast(day.date);
    return (
      <td {...(props as TdHTMLAttributes<HTMLTableCellElement>)}>
        {children && (
          <span className="jood-day">
            <span className="block leading-none">{children}</span>
            {visible && d?.available && d.price !== null && (
              <span className="mt-1 block text-[10px] leading-none opacity-70">{numberFmt.format(d.price)}</span>
            )}
            {visible && d && !d.available && d.price !== null && (
              <span className="mt-1 block text-[10px] leading-none">محجوز</span>
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
        month={month}
        onMonthChange={setMonth}
        startMonth={new Date(today.getFullYear(), today.getMonth())}
        disabled={{ before: today }}
        modifiers={{
          peak: (d: Date) => {
            const i = info(d);
            const prices = [...days.values()].map((x) => x.price ?? 0);
            return !!i?.available && i.price !== null && prices.length > 0 && i.price === Math.max(...prices);
          },
          booked: (d: Date) => {
            const i = info(d);
            return !!i && !i.available && i.price !== null && !isPast(d);
          },
        }}
        modifiersClassNames={{ peak: "jood-peak", booked: "jood-booked" }}
        components={{ Day: PricedDay }}
      />
      {error && <p className="mt-3 text-center text-xs text-jood-ink/60">تعذر تحميل الأسعار، حاول لاحقًا.</p>}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-jood-ink/70">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full border border-jood-green/30 bg-white" />
          متاح
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full bg-jood-gold/40" />
          متاح بسعر أعلى
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full bg-jood-green/15" />
          محجوز
        </span>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarBooking } from "../types";
import { STATUS } from "../labels";
import { Button, Card, ErrorNote, Loading, PageTitle, StatusBadge, useApi } from "../ui";
import { toIso } from "../../lib/format";

type View = "month" | "week" | "day";
const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const monthFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function range(view: View, anchor: Date): { start: Date; end: Date } {
  if (view === "day") return { start: anchor, end: addDays(anchor, 1) };
  if (view === "week") {
    const start = addDays(anchor, -anchor.getDay());
    return { start, end: addDays(start, 7) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { start, end: addDays(last, (7 - last.getDay()) % 7) };
}

function Chip({ b }: { b: CalendarBooking }) {
  return (
    <Link
      to={`/admin/bookings/${b.id}`}
      title={`${b.guest.name} — ${STATUS[b.status].label}`}
      className={`block truncate rounded-md px-1.5 py-0.5 text-[11px] leading-5 ${STATUS[b.status].className} ${b.kind === "FULL" ? "font-semibold" : "border border-dashed border-current/40"}`}
    >
      {b.kind === "FULL" ? "كاملة" : b.resources.map((r) => r.name).join("، ")} · {b.guest.name}
    </Link>
  );
}

export default function CalendarPage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const { start, end } = range(view, anchor);
  const { data, error, loading } = useApi<{ bookings: CalendarBooking[] }>(`/api/admin/calendar?from=${toIso(start)}&to=${toIso(end)}`);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of data?.bookings ?? []) {
      for (let d = new Date(`${b.startDate.slice(0, 10)}T00:00:00`); toIso(d) < b.endDate.slice(0, 10); d = addDays(d, 1)) {
        const k = toIso(d);
        map.set(k, [...(map.get(k) ?? []), b]);
      }
    }
    return map;
  }, [data]);

  const step = (dir: number) =>
    setAnchor((a) => (view === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (view === "week" ? 7 : 1))));

  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  const title = view === "month" ? monthFmt.format(anchor) : view === "day" ? dayFmt.format(anchor) : `${dayFmt.format(start)} — ${dayFmt.format(addDays(end, -1))}`;

  return (
    <>
      <PageTitle title="التقويم">
        <div className="flex rounded-full border border-jood-green/20 p-0.5" role="group" aria-label="طريقة العرض">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-sm ${view === v ? "bg-jood-green text-jood-beige" : ""}`}>
              {v === "month" ? "شهري" : v === "week" ? "أسبوعي" : "يومي"}
            </button>
          ))}
        </div>
      </PageTitle>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => step(-1)} aria-label="السابق"><ChevronRight className="size-5" /></Button>
          <div className="text-center">
            <h2 className="font-display text-lg font-semibold text-jood-green">{title}</h2>
            <button type="button" className="text-xs text-jood-green underline" onClick={() => setAnchor(today)}>اليوم</button>
          </div>
          <Button variant="ghost" onClick={() => step(1)} aria-label="التالي"><ChevronLeft className="size-5" /></Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
        {loading && !data ? (
          <Loading />
        ) : view === "day" ? (
          <ul className="space-y-2">
            {(byDay.get(toIso(anchor)) ?? []).length === 0 && <li className="py-8 text-center text-sm text-jood-ink/60">لا توجد حجوزات في هذا اليوم — الاستراحة متاحة.</li>}
            {(byDay.get(toIso(anchor)) ?? []).map((b) => (
              <li key={b.id}>
                <Link to={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-jood-green/10 p-3 hover:bg-jood-beige/50">
                  <StatusBadge status={b.status} />
                  <span className="font-medium">{b.guest.name}</span>
                  <span className="text-sm text-jood-ink/65">{b.kind === "FULL" ? "الاستراحة كاملة" : b.resources.map((r) => r.name).join("، ")}</span>
                  <span dir="ltr" className="ms-auto text-xs text-jood-ink/55">{b.reference}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[42rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-jood-green/10 bg-jood-green/10">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-jood-beige px-2 py-1.5 text-center text-xs text-jood-ink/65">{w}</div>
              ))}
              {days.map((d) => {
                const k = toIso(d);
                const list = byDay.get(k) ?? [];
                const outside = view === "month" && d.getMonth() !== anchor.getMonth();
                return (
                  <div key={k} className={`${view === "week" ? "min-h-48" : "min-h-24"} bg-white p-1.5 ${outside ? "opacity-40" : ""}`}>
                    <button type="button" onClick={() => { setAnchor(d); setView("day"); }} className={`mb-1 grid size-6 place-items-center rounded-full text-xs ${k === toIso(today) ? "bg-jood-gold text-jood-green-950 font-semibold" : "text-jood-ink/70 hover:bg-jood-beige"}`}>
                      {d.getDate()}
                    </button>
                    <div className="space-y-1">{list.map((b) => <Chip key={b.id} b={b} />)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-jood-ink/70">
          {(["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5"><span className={`size-3 rounded ${STATUS[s].className}`} />{STATUS[s].label}</span>
          ))}
          <span className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-jood-ink/40" />حجز جزئي</span>
        </div>
      </Card>
    </>
  );
}

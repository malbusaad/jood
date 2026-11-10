import { useState } from "react";
import { Card, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi } from "../ui";

interface Month { month: string; bookings: number; bookingValue: number; collected: number; expenses: number; net: number }
interface Report { year: number; months: Month[]; total: Omit<Month, "month">; byCategory: Record<string, number> }

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** «التقارير المالية»: monthly booking value, money collected, expenses and net. */
export default function ReportsPage() {
  const [year, setYear] = useState(() => Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).slice(0, 4)));
  const { data, error, loading } = useApi<Report>(`/api/admin/reports/monthly?year=${year}`);
  const max = data ? Math.max(1, ...data.months.map((m) => Math.max(m.bookingValue, m.expenses))) : 1;
  return (
    <>
      <PageTitle title="التقارير المالية" />
      <div className="mb-4 flex items-end gap-3">
        <Field label="السنة"><input type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${inputClass} w-28`} /></Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {[
              ["قيمة الحجوزات المؤكدة", data.total.bookingValue],
              ["المحصّل المسجل", data.total.collected],
              ["المصاريف", data.total.expenses],
              ["الصافي (الحجوزات − المصاريف)", data.total.net],
            ].map(([label, v]) => (
              <Card key={label as string}>
                <p className="text-xs text-jood-ink/60">{label}</p>
                <p className={`mt-1 font-display text-2xl font-semibold ${Number(v) < 0 ? "text-red-800" : "text-jood-green"}`}>{money(v as number)}</p>
              </Card>
            ))}
          </div>
          <Card title={`الشهور — ${data.year}`}>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-xs text-jood-ink/60">
                  <tr><th className="px-5 py-2 text-start">الشهر</th><th className="text-start">الحجوزات</th><th className="text-start">قيمة الحجوزات</th><th className="text-start">المحصّل</th><th className="text-start">المصاريف</th><th className="text-start">الصافي</th><th className="w-40" /></tr>
                </thead>
                <tbody>
                  {data.months.map((m, i) => (
                    <tr key={m.month} className="border-t border-jood-green/10">
                      <td className="px-5 py-2">{MONTHS[i]}</td>
                      <td>{m.bookings || "—"}</td>
                      <td>{m.bookingValue ? money(m.bookingValue) : "—"}</td>
                      <td>{m.collected ? money(m.collected) : "—"}</td>
                      <td>{m.expenses ? money(m.expenses) : "—"}</td>
                      <td className={m.net < 0 ? "text-red-800" : ""}>{m.bookingValue || m.expenses ? money(m.net) : "—"}</td>
                      <td className="pe-5" aria-hidden>
                        <div className="h-2 rounded-full bg-jood-green" style={{ width: `${(m.bookingValue / max) * 100}%` }} />
                        <div className="mt-1 h-2 rounded-full bg-jood-gold" style={{ width: `${(m.expenses / max) * 100}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-6 text-jood-ink/60">
              <span className="me-1 inline-block size-2 rounded-full bg-jood-green" />قيمة الحجوزات
              <span className="me-1 ms-3 inline-block size-2 rounded-full bg-jood-gold" />المصاريف.
              قيمة الحجوزات تُحسب في شهر أول يوم للحجز. «المحصّل» هو ما سُجل من دفعات متحقق منها (بعد خصم الاسترداد)، والتأمين لا يُحسب دخلًا.
            </p>
          </Card>
          {Object.keys(data.byCategory).length > 0 && (
            <Card title="المصاريف حسب التصنيف" className="mt-5">
              <ul className="space-y-1 text-sm">
                {Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                  <li key={c} className="flex justify-between"><span>{c}</span><span>{money(v)}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { ar } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { BookingOption, BookingReceipt, CalendarDay, Quote } from "../content/types";
import { formatDateAr, formatSAR, toIso } from "../lib/format";
import { useSiteContent } from "../hooks/useSiteContent";
import CopyButton from "./CopyButton";

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * Day prices for the picker. The day component is defined once at module level and reads this
 * context: a component defined inside render would get a new identity on every render, making
 * React rebuild every day button (lost clicks and keyboard focus while data loads).
 */
const DaysContext = createContext<Map<string, CalendarDay>>(new Map());

function DayWithPrice({ day, modifiers, children, ...props }: DayButtonProps) {
  const info = useContext(DaysContext).get(toIso(day.date));
  return (
    <button {...props}>
      <span className="block leading-none">{children}</span>
      {!modifiers.disabled && info && (
        <span className="mt-1 block text-[10px] leading-none opacity-75">
          {info.available && info.price !== null ? numberFmt.format(info.price) : "محجوز"}
        </span>
      )}
    </button>
  );
}

const pickerComponents = { DayButton: DayWithPrice };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-jood-green/10 bg-white/80 p-5 sm:p-7">
      <h2 className="flex items-center gap-3 font-display text-xl font-semibold text-jood-green">
        <span className="grid size-8 place-items-center rounded-full bg-jood-green text-sm text-jood-gold">{n}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The booking request form. Every price and availability shown here comes from the server. */
export default function BookingForm() {
  const site = useSiteContent();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [days, setDays] = useState<Map<string, CalendarDay>>(new Map());
  const [date, setDate] = useState<Date | undefined>();
  const [nights, setNights] = useState(1);
  const [options, setOptions] = useState<BookingOption[] | null>(null);
  const [maxNights, setMaxNights] = useState(7);
  const [mode, setMode] = useState<"FULL" | "PART">("FULL");
  const [parts, setParts] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState({ name: "", nationalId: "", phone: "", email: "", guestCount: "", notes: "", acceptTerms: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  /** Bumped to re-check availability (e.g. after the chosen date was just taken). */
  const [refreshKey, setRefreshKey] = useState(0);

  // Month availability of the full rest house (for the calendar marks).
  useEffect(() => {
    const from = toIso(month);
    const to = toIso(new Date(month.getFullYear(), month.getMonth() + 1, 1));
    api<{ days: CalendarDay[] }>(`/api/public/calendar?from=${from}&to=${to}`)
      .then((r) => setDays(new Map(r.days.map((d) => [d.date, d]))))
      .catch(() => setDays(new Map()));
  }, [month]);

  // What can be booked for the chosen date and length.
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setOptions(null);
    setQuote(null);
    api<{ options: BookingOption[]; maxNights: number }>(`/api/public/options?startDate=${toIso(date)}&nights=${nights}`)
      .then((r) => {
        if (cancelled) return;
        setOptions(r.options);
        setMaxNights(r.maxNights);
        const full = r.options.find((o) => o.kind === "FULL");
        setMode(full?.available || !r.options.some((o) => o.kind === "PART" && o.available) ? "FULL" : "PART");
        setParts((prev) => prev.filter((id) => r.options.some((o) => o.id === id && o.available)));
      })
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [date, nights, refreshKey]);

  const full = options?.find((o) => o.kind === "FULL") ?? null;
  const partOptions = options?.filter((o) => o.kind === "PART") ?? [];
  const selection = mode === "FULL" ? (full?.available ? [full.id] : []) : parts;

  // Exact price for the current selection, recomputed by the server.
  useEffect(() => {
    if (!date || selection.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    api<Quote>("/api/public/quote", {
      method: "POST",
      body: JSON.stringify({ resourceIds: selection, startDate: toIso(date), nights }),
    })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote({ available: false, reason: "تعذر حساب السعر، حاول مرة أخرى" }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, nights, selection.join(",")]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!date || !quote?.available) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<BookingReceipt>("/api/public/bookings", {
        method: "POST",
        body: JSON.stringify({
          resourceIds: selection,
          startDate: toIso(date),
          nights,
          name: form.name,
          nationalId: form.nationalId,
          phone: form.phone,
          email: form.email || null,
          guestCount: form.guestCount ? Number(form.guestCount) : null,
          notes: form.notes || null,
          acceptTerms: form.acceptTerms,
          website: form.website,
        }),
      });
      setReceipt(r);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر إرسال الطلب، حاول مرة أخرى");
      if (err instanceof ApiError && err.status === 409) setRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) return <Receipt receipt={receipt} phone={form.phone} />;

  const input = "w-full rounded-xl border border-jood-green/20 bg-white px-4 py-3 outline-none transition focus:border-jood-gold";

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Step n={1} title="اختر التاريخ">
        <div className="jood-calendar jood-picker overflow-x-auto">
          <DaysContext.Provider value={days}>
            <DayPicker
              mode="single"
              required={false}
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setError(null);
              }}
              locale={ar}
              dir="rtl"
              numerals="latn"
              weekStartsOn={0}
              month={month}
              onMonthChange={setMonth}
              startMonth={new Date(today.getFullYear(), today.getMonth())}
              disabled={{ before: today }}
              modifiers={{ booked: (d: Date) => days.get(toIso(d))?.available === false && d >= today }}
              modifiersClassNames={{ booked: "jood-booked" }}
              components={pickerComponents}
            />
          </DaysContext.Provider>
        </div>
        <p className="mt-2 text-xs text-jood-ink/60">الأسعار تحت الأيام للاستراحة كاملة. «محجوز» تعني أن الاستراحة كاملة غير متاحة، وقد تتوفر أجزاء منها.</p>
        <label className="mt-5 flex flex-wrap items-center gap-3">
          <span className="text-sm">عدد الأيام</span>
          <select value={nights} onChange={(e) => setNights(Number(e.target.value))} className="rounded-xl border border-jood-green/20 bg-white px-3 py-2">
            {Array.from({ length: maxNights }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {date && (
            <span className="text-sm text-jood-ink/70">
              من {formatDateAr(toIso(date))}
            </span>
          )}
        </label>
      </Step>

      {date && (
        <Step n={2} title="ماذا تريد أن تحجز؟">
          {!options ? (
            <p className="flex items-center gap-2 text-sm text-jood-ink/60">
              <Loader2 aria-hidden className="size-4 animate-spin" /> جارٍ التحقق من الإتاحة…
            </p>
          ) : (
            <div className="space-y-3">
              {full && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${mode === "FULL" ? "border-jood-gold bg-jood-gold/10" : "border-jood-green/15"} ${!full.available ? "opacity-60" : ""}`}>
                  <input type="radio" name="mode" checked={mode === "FULL"} onChange={() => setMode("FULL")} disabled={!full.available} className="mt-1 accent-jood-green" />
                  <span className="flex-1">
                    <span className="block font-medium">{full.name}</span>
                    <span className="block text-sm text-jood-ink/70">
                      {full.available ? formatSAR(full.total!) : full.reason}
                    </span>
                  </span>
                </label>
              )}
              {partOptions.length > 0 && (
                <div className={`rounded-2xl border p-4 ${mode === "PART" ? "border-jood-gold bg-jood-gold/10" : "border-jood-green/15"}`}>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="radio" name="mode" checked={mode === "PART"} onChange={() => setMode("PART")} disabled={!partOptions.some((p) => p.available)} className="accent-jood-green" />
                    <span className="font-medium">أجزاء من الاستراحة</span>
                  </label>
                  {mode === "PART" && (
                    <ul className="mt-3 space-y-2 ps-7">
                      {partOptions.map((p) => (
                        <li key={p.id}>
                          <label className={`flex cursor-pointer items-start gap-3 ${!p.available ? "opacity-60" : ""}`}>
                            <input
                              type="checkbox"
                              checked={parts.includes(p.id)}
                              disabled={!p.available}
                              onChange={(e) => setParts((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                              className="mt-1 accent-jood-green"
                            />
                            <span>
                              <span className="block">{p.name}</span>
                              <span className="block text-xs text-jood-ink/60">
                                {p.available ? formatSAR(p.total!) : p.reason}
                                {p.amenities.length > 0 && ` · يشمل: ${p.amenities.join("، ")}`}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {full && !full.available && !partOptions.some((p) => p.available) && (
                <p className="text-sm text-jood-ink/70">لا يوجد ما يمكن حجزه في هذا التاريخ. جرّب تاريخًا آخر.</p>
              )}
            </div>
          )}
        </Step>
      )}

      {quote && (
        <Step n={3} title="السعر">
          {quote.available ? (
            <div>
              <table className="w-full text-sm">
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={`${l.date}-${l.resourceId}`} className="border-b border-jood-green/10">
                      <td className="py-2">{formatDateAr(l.date)}</td>
                      <td className="py-2 text-jood-ink/70">{l.resourceName}</td>
                      <td className="py-2 text-end">{formatSAR(Number(l.price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt>مبلغ الحجز</dt><dd>{formatSAR(quote.total)}</dd></div>
                {quote.deposit > 0 && (
                  <div className="flex justify-between text-jood-ink/70"><dt>مبلغ التأمين (يُسترد بعد المغادرة)</dt><dd>{formatSAR(quote.deposit)}</dd></div>
                )}
                <div className="flex justify-between border-t border-jood-green/10 pt-2 font-display text-lg font-semibold text-jood-green">
                  <dt>الإجمالي المستحق</dt><dd>{formatSAR(quote.payable)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-jood-ink/80">{quote.reason}</p>
          )}
        </Step>
      )}

      {quote?.available && (
        <Step n={4} title="بياناتك">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm">الاسم الثلاثي</span>
              <input required autoComplete="name" placeholder="الاسم واسم الأب واسم العائلة" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm">رقم الهوية أو الإقامة</span>
              <input required inputMode="numeric" dir="ltr" maxLength={10} placeholder="1xxxxxxxxx" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className={`mt-1 text-end ${input}`} />
              <span className="mt-1 block text-xs text-jood-ink/60">يُستخدم في عقد الإيجار فقط، ويُحفظ مشفّرًا ولا يظهر في الموقع.</span>
            </label>
            <label className="block">
              <span className="text-sm">رقم الجوال (واتساب)</span>
              <input required type="tel" inputMode="tel" dir="ltr" autoComplete="tel" placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`mt-1 text-end ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm">البريد الإلكتروني (اختياري)</span>
              <input type="email" dir="ltr" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`mt-1 text-end ${input}`} />
            </label>
            <label className="block">
              <span className="text-sm">عدد الضيوف المتوقع (اختياري)</span>
              <input type="number" min={1} inputMode="numeric" value={form.guestCount} onChange={(e) => setForm({ ...form, guestCount: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm">ملاحظات (اختياري)</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            {/* Honeypot — hidden from people, filled by bots */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" />
          </div>
          <label className="mt-5 flex items-start gap-3 text-sm">
            <input type="checkbox" checked={form.acceptTerms} onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })} className="mt-1 accent-jood-green" />
            <span>
              قرأت <Link to="/terms" target="_blank" className="text-jood-green underline decoration-jood-gold underline-offset-4">الشروط والتعليمات</Link> وأوافق عليها.
            </span>
          </label>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7 text-jood-ink/80">
            <Info aria-hidden className="mt-1 size-4 shrink-0 text-jood-gold" />
            هذا طلب حجز وليس حجزًا مؤكدًا. سيتواصل معك {site.general.name} عبر واتساب لتأكيد التفاصيل وإرسال العقد، ويتأكد الحجز بعد التحقق من وصول المبلغ.
          </p>
          <button
            type="submit"
            disabled={submitting || form.name.trim().split(/\s+/).length < 3 || !form.nationalId.trim() || !form.phone.trim() || !form.acceptTerms}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-jood-green px-8 py-3.5 text-jood-beige transition hover:bg-jood-green-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
            إرسال طلب الحجز
          </button>
        </Step>
      )}

      {/* Outside the steps so it stays visible while availability is re-checked. */}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}

function Receipt({ receipt, phone }: { receipt: BookingReceipt; phone: string }) {
  return (
    <section className="rounded-3xl border border-jood-gold/40 bg-white/90 p-6 sm:p-8" aria-live="polite">
      <CheckCircle2 aria-hidden className="size-10 text-jood-gold" strokeWidth={1.25} />
      <h2 className="mt-4 font-display text-2xl font-semibold text-jood-green">تم استلام طلب الحجز</h2>
      <p className="mt-2 text-jood-ink/80">
        رقم الطلب: <strong dir="ltr" className="font-display text-xl text-jood-green">{receipt.reference}</strong>
      </p>
      <p className="mt-4 leading-8 text-jood-ink/80">
        سنتواصل معك قريبًا عبر واتساب على الرقم <span dir="ltr">{phone}</span> لتأكيد التفاصيل وإرسال العقد. الحجز غير مؤكد حتى يتم التحقق من وصول المبلغ.
      </p>

      <dl className="mt-6 grid gap-2 rounded-2xl bg-jood-beige p-5 text-sm">
        <div className="flex justify-between gap-4"><dt>المحجوز</dt><dd className="text-end">{receipt.items.join("، ")}</dd></div>
        <div className="flex justify-between gap-4"><dt>الدخول</dt><dd>{formatDateAr(receipt.startDate)}</dd></div>
        <div className="flex justify-between gap-4"><dt>الخروج</dt><dd>{formatDateAr(receipt.endDate)}</dd></div>
        <div className="flex justify-between gap-4"><dt>مبلغ الحجز</dt><dd>{formatSAR(receipt.total)}</dd></div>
        {receipt.deposit > 0 && <div className="flex justify-between gap-4"><dt>مبلغ التأمين (مسترد)</dt><dd>{formatSAR(receipt.deposit)}</dd></div>}
        <div className="flex justify-between gap-4 border-t border-jood-green/10 pt-2 font-semibold text-jood-green"><dt>الإجمالي المستحق</dt><dd>{formatSAR(receipt.payable)}</dd></div>
      </dl>

      {receipt.bank && (
        <div className="mt-6">
          <h3 className="font-display text-lg font-semibold text-jood-green">بيانات التحويل البنكي</h3>
          <p className="mt-1 text-sm text-jood-ink/70">حوّل المبلغ بعد استلام العقد وموافقتك عليه.</p>
          <dl className="mt-3 grid gap-2 text-sm">
            {receipt.bank.bankName && <div className="flex justify-between gap-4"><dt>البنك</dt><dd>{receipt.bank.bankName}</dd></div>}
            {receipt.bank.accountHolder && <div className="flex justify-between gap-4"><dt>اسم صاحب الحساب</dt><dd>{receipt.bank.accountHolder}</dd></div>}
            {receipt.bank.iban && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt>رقم الآيبان</dt>
                <dd className="flex items-center gap-2">
                  <span dir="ltr" className="font-mono">{receipt.bank.iban}</span>
                  <CopyButton value={receipt.bank.iban} label="نسخ الآيبان" />
                </dd>
              </div>
            )}
          </dl>
          {receipt.bank.instructions && <p className="mt-3 whitespace-pre-line text-sm text-jood-ink/70">{receipt.bank.instructions}</p>}
        </div>
      )}
      <p className="mt-6 text-xs text-jood-ink/60">احتفظ برقم الطلب للتواصل بخصوص حجزك.</p>
    </section>
  );
}

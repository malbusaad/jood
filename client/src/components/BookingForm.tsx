import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { ar } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { DepositTiming, PaymentPlan, BookingOption, BookingReceipt, CalendarDay, Quote } from "../content/types";
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

function Step({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-jood-green/10 bg-white/80 p-5 sm:p-7">
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
  /** Discount code: what the guest typed, and the code sent for checking (the server decides). */
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  /** How the guest will pay: full amount or deposit; security deposit with the first payment or before check-in. */
  const [plan, setPlan] = useState<PaymentPlan>("FULL");
  const [depositTiming, setDepositTiming] = useState<DepositTiming>("WITH_FIRST_PAYMENT");
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
      body: JSON.stringify({ resourceIds: selection, startDate: toIso(date), nights, ...(appliedCode ? { discountCode: appliedCode } : {}) }),
    })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote({ available: false, reason: "تعذر حساب السعر، حاول مرة أخرى" }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, nights, selection.join(","), appliedCode]);

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
          // Only a code the server accepted for this quote is sent; the amount is never sent.
          discountCode: quote.discount ? quote.discount.code : null,
          paymentPlan: plan === "DEPOSIT" && quote.paymentOptions?.depositPlan ? "DEPOSIT" : "FULL",
          depositTiming,
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
                // Take the guest straight to the next step (what to book and the price).
                if (d) {
                  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  setTimeout(() => document.getElementById("booking-step-2")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }), 120);
                }
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
        <Step n={2} title="ماذا تريد أن تحجز؟" id="booking-step-2">
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
                      <td className="py-2">
                        {formatDateAr(l.date)}
                        {l.ruleKind && l.ruleKind !== "WEEKDAY" && l.ruleLabel && (
                          <span className="mt-1 block w-fit rounded-full bg-jood-gold/15 px-2 py-0.5 text-xs text-jood-green">{l.ruleLabel}</span>
                        )}
                      </td>
                      <td className="py-2 text-jood-ink/70">{l.resourceName}</td>
                      <td className="whitespace-nowrap py-2 text-end">{formatSAR(Number(l.price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-4 space-y-1 text-sm">
                {quote.discount && (
                  <>
                    <div className="flex justify-between text-jood-ink/70"><dt>مبلغ الحجز قبل الخصم</dt><dd>{formatSAR(quote.subtotal ?? quote.total + quote.discount.amount)}</dd></div>
                    <div className="flex justify-between text-emerald-700"><dt>الخصم (<span dir="ltr">{quote.discount.code}</span>)</dt><dd>− {formatSAR(quote.discount.amount)}</dd></div>
                  </>
                )}
                <div className="flex justify-between"><dt>{quote.discount ? "مبلغ الحجز بعد الخصم" : "مبلغ الحجز"}</dt><dd>{formatSAR(quote.total)}</dd></div>
                {quote.deposit > 0 && (
                  <div className="flex justify-between text-jood-ink/70"><dt>مبلغ التأمين (يُسترد بعد المغادرة)</dt><dd>{formatSAR(quote.deposit)}</dd></div>
                )}
                <div className="flex justify-between border-t border-jood-green/10 pt-2 font-display text-lg font-semibold text-jood-green">
                  <dt>الإجمالي المستحق</dt><dd>{formatSAR(quote.payable)}</dd>
                </div>
              </dl>
              <div className="mt-5 border-t border-jood-green/10 pt-4">
                <label htmlFor="discount-code" className="text-sm">كود الخصم (اختياري)</label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="discount-code"
                    dir="ltr"
                    autoComplete="off"
                    maxLength={30}
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (codeInput.trim()) setAppliedCode(codeInput.trim());
                      }
                    }}
                    className={`min-w-0 flex-1 text-end uppercase ${input}`}
                  />
                  {appliedCode && quote.discount ? (
                    <button type="button" onClick={() => { setAppliedCode(null); setCodeInput(""); }} className="rounded-xl border border-jood-green/20 px-4 text-sm">
                      إزالة
                    </button>
                  ) : (
                    <button type="button" disabled={!codeInput.trim()} onClick={() => setAppliedCode(codeInput.trim())} className="rounded-xl bg-jood-green px-4 text-sm text-jood-beige disabled:opacity-50">
                      تطبيق
                    </button>
                  )}
                </div>
                {appliedCode && quote.discountError && <p role="alert" className="mt-2 text-sm text-red-700">{quote.discountError}</p>}
                {quote.discount && <p className="mt-2 text-sm text-emerald-700">تم تطبيق الخصم. التأمين لا يدخل في الخصم.</p>}
              </div>
              <PaymentChoice quote={quote} plan={plan} setPlan={setPlan} depositTiming={depositTiming} setDepositTiming={setDepositTiming} />
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
            {/* Optional details folded away so the form stays short. */}
            <details className="group sm:col-span-2">
              <summary className="cursor-pointer text-sm text-jood-green underline decoration-jood-gold underline-offset-4">تفاصيل إضافية (اختياري): البريد، عدد الضيوف، ملاحظات</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
              </div>
            </details>
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
            هذا طلب حجز وليس حجزًا مؤكدًا. سيتواصل معك {site.general.name} عبر واتساب لتأكيد التفاصيل وإرسال العقد، ويتأكد الحجز بعد التحقق من وصول المبلغ. بإرسال الطلب توافق على استلام رسائل حجزك (التأكيد والتذكير ورمز الدخول) على واتساب من رقم الاستراحة.
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
        {receipt.discount && (
          <div className="flex justify-between gap-4 text-emerald-700"><dt>الخصم (<span dir="ltr">{receipt.discount.code}</span>)</dt><dd>− {formatSAR(receipt.discount.amount)}</dd></div>
        )}
        <div className="flex justify-between gap-4"><dt>مبلغ الحجز</dt><dd>{formatSAR(receipt.total)}</dd></div>
        {receipt.deposit > 0 && <div className="flex justify-between gap-4"><dt>مبلغ التأمين (مسترد)</dt><dd>{formatSAR(receipt.deposit)}</dd></div>}
        <div className="flex justify-between gap-4 border-t border-jood-green/10 pt-2 font-semibold text-jood-green"><dt>الإجمالي المستحق</dt><dd>{formatSAR(receipt.payable)}</dd></div>
      </dl>
      {receipt.dueNow !== undefined && (
        <div className="mt-4 rounded-2xl border border-jood-gold/40 p-5 text-sm">
          <p className="flex justify-between gap-4 font-display text-lg font-semibold text-jood-green">
            <span>المطلوب تحويله لتأكيد الحجز</span><span>{formatSAR(receipt.dueNow)}</span>
          </p>
          <p className="mt-2 leading-7 text-jood-ink/75">
            {receipt.paymentPlan === "DEPOSIT" ? `عربون ${formatSAR(receipt.upfront ?? 0)}` : `كامل مبلغ الحجز ${formatSAR(receipt.total)}`}
            {receipt.depositTiming === "WITH_FIRST_PAYMENT" && receipt.deposit > 0 ? ` + التأمين ${formatSAR(receipt.deposit)}` : ""}.
            {(() => {
              const later = [
                receipt.paymentPlan === "DEPOSIT" ? `باقي مبلغ الحجز ${formatSAR(receipt.total - (receipt.upfront ?? 0))}` : null,
                receipt.depositTiming === "BEFORE_CHECKIN" && receipt.deposit > 0 ? `التأمين ${formatSAR(receipt.deposit)}` : null,
              ].filter(Boolean);
              return later.length ? ` ويُسدَّد ${later.join(" و")} قبل موعد الدخول بـ ${receipt.balanceDueHours ?? 24} ساعة.` : "";
            })()}
          </p>
          <p className="mt-2 text-xs text-jood-ink/60">يصلك رمز الدخول بعد اكتمال سداد مبلغ الحجز والتأمين.</p>
        </div>
      )}

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

/** The two ways to pay, with the exact amounts from the server's quote. The deposit is shown separately. */
function PaymentChoice({
  quote,
  plan,
  setPlan,
  depositTiming,
  setDepositTiming,
}: {
  quote: Extract<Quote, { available: true }>;
  plan: PaymentPlan;
  setPlan: (p: PaymentPlan) => void;
  depositTiming: DepositTiming;
  setDepositTiming: (t: DepositTiming) => void;
}) {
  const dp = quote.paymentOptions?.depositPlan ?? null;
  const hours = quote.paymentOptions?.balanceDueHours ?? 24;
  const chosen = plan === "DEPOSIT" && dp ? "DEPOSIT" : "FULL";
  const upfront = chosen === "DEPOSIT" ? dp!.upfront : quote.total;
  const dueNow = upfront + (depositTiming === "WITH_FIRST_PAYMENT" ? quote.deposit : 0);
  const option = "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition";
  const on = "border-jood-gold bg-jood-gold/10";
  const off = "border-jood-green/15";
  return (
    <div className="mt-5 border-t border-jood-green/10 pt-4">
      <fieldset>
        <legend className="text-sm font-medium">طريقة الدفع</legend>
        <div className="mt-2 grid gap-2">
          <label className={`${option} ${chosen === "FULL" ? on : off}`}>
            <input type="radio" name="plan" className="mt-1 accent-jood-green" checked={chosen === "FULL"} onChange={() => setPlan("FULL")} />
            <span>
              <span className="block font-medium">دفع كامل المبلغ مقدمًا</span>
              <span className="text-jood-ink/70">{formatSAR(quote.total)}</span>
            </span>
          </label>
          {dp && (
            <label className={`${option} ${chosen === "DEPOSIT" ? on : off}`}>
              <input type="radio" name="plan" className="mt-1 accent-jood-green" checked={chosen === "DEPOSIT"} onChange={() => setPlan("DEPOSIT")} />
              <span>
                <span className="block font-medium">عربون {dp.percent}% مقدمًا</span>
                <span className="text-jood-ink/70">
                  {formatSAR(dp.upfront)} الآن، والباقي {formatSAR(quote.total - dp.upfront)} قبل الدخول بـ {hours} ساعة
                </span>
              </span>
            </label>
          )}
        </div>
      </fieldset>
      {quote.deposit > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">التأمين ({formatSAR(quote.deposit)} — يُسترد بعد المغادرة)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={`${option} ${depositTiming === "WITH_FIRST_PAYMENT" ? on : off}`}>
              <input type="radio" name="depositTiming" className="mt-1 accent-jood-green" checked={depositTiming === "WITH_FIRST_PAYMENT"} onChange={() => setDepositTiming("WITH_FIRST_PAYMENT")} />
              <span>مع {chosen === "DEPOSIT" ? "العربون" : "الدفعة المقدمة"}</span>
            </label>
            <label className={`${option} ${depositTiming === "BEFORE_CHECKIN" ? on : off}`}>
              <input type="radio" name="depositTiming" className="mt-1 accent-jood-green" checked={depositTiming === "BEFORE_CHECKIN"} onChange={() => setDepositTiming("BEFORE_CHECKIN")} />
              <span>قبل الدخول بـ {hours} ساعة</span>
            </label>
          </div>
        </fieldset>
      )}
      <p className="mt-4 flex justify-between rounded-xl bg-jood-green px-4 py-3 text-jood-beige">
        <span>المطلوب الآن لتأكيد الحجز</span>
        <strong>{formatSAR(dueNow)}</strong>
      </p>
    </div>
  );
}

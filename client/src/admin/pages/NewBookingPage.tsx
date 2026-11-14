import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import type { ResourceRef } from "../types";
import { Button, Card, ErrorNote, Field, PageTitle, dayLabel, inputClass, money, useApi, useMutation } from "../ui";
import { DISCOUNT_LABEL, previewDiscount, r2, type DiscountType } from "../manualDiscount";
import DayChips from "./DayChips";
import GuestAutocomplete, { type SuggestedGuest } from "./GuestAutocomplete";

type Q = { available: true; total: number; deposit: number } | { available: false; reason: string };
type Method = "BANK_TRANSFER" | "CASH" | "GATHERN";

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-jood-green">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-jood-green text-sm text-jood-beige">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** Records a booking made outside the website (Gathern, phone). Same conflict and price rules as the website. */
export default function NewBookingPage() {
  const navigate = useNavigate();
  const { data } = useApi<{ resources: (ResourceRef & { active: boolean })[] }>("/api/admin/resources");
  const m = useMutation();
  const [f, setF] = useState({ channel: "GATHERN" as "GATHERN" | "MANUAL", startDate: "", endDate: "", resourceIds: [] as string[], name: "", nationalId: "", phone: "", guestCount: "", adminNotes: "", paymentPlan: "FULL" as "FULL" | "DEPOSIT", depositTiming: "WITH_FIRST_PAYMENT" as "WITH_FIRST_PAYMENT" | "BEFORE_CHECKIN", securityDeposit: "" });
  const [disc, setDisc] = useState({ on: false, type: "FIXED" as DiscountType, value: "" });
  const [pay, setPay] = useState({ amount: "", method: "" as Method | "" });
  const [quote, setQuote] = useState<Q | null>(null);
  /** Consecutive days (check-in → check-out) or separate days chosen one by one. */
  const [mode, setMode] = useState<"RANGE" | "SEPARATE">("RANGE");
  const [days, setDays] = useState<string[]>([]);
  /** A returning customer chosen from the suggestions (the booking is linked to their record). */
  const [guest, setGuest] = useState<SuggestedGuest | null>(null);

  const resources = data?.resources.filter((r) => r.active) ?? [];
  const rangeNights = f.startDate && f.endDate ? daysBetween(f.startDate, f.endDate) : 0;
  const nights = mode === "SEPARATE" ? days.length : rangeNights;
  const datesOk = nights >= 1 && nights <= 30;
  const firstDay = mode === "SEPARATE" ? (days[0] ?? "") : f.startDate;
  const sepKey = mode === "SEPARATE" ? days.join(",") : "";

  useEffect(() => {
    if (!firstDay || !datesOk || f.resourceIds.length === 0) return setQuote(null);
    let cancelled = false;
    const dates = sepKey ? sepKey.split(",") : null;
    api<Q>("/api/admin/bookings/quote", { method: "POST", body: JSON.stringify({ resourceIds: f.resourceIds, startDate: firstDay, nights, dates }) })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [firstDay, nights, datesOk, f.resourceIds, sepKey]);

  function toggle(id: string, kind: string) {
    setF((s) => {
      if (kind === "FULL") return { ...s, resourceIds: s.resourceIds.includes(id) ? [] : [id] };
      const fullIds = resources.filter((r) => r.kind === "FULL").map((r) => r.id);
      const rest = s.resourceIds.filter((x) => !fullIds.includes(x));
      return { ...s, resourceIds: rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id] };
    });
  }

  function setStart(startDate: string) {
    // Keep the stay length when the check-in moves; a fresh form defaults to one day.
    const keep = rangeNights >= 1 && rangeNights <= 30 ? rangeNights : 1;
    setF({ ...f, startDate, endDate: startDate ? addDays(startDate, keep) : "" });
  }

  // ---- price ----
  const base = quote?.available ? quote.total : null;
  const preview = base != null && disc.on ? previewDiscount(base, disc.type, disc.value) : null;
  const discountError = preview && "error" in preview ? preview.error : null;
  const discountOk = preview && !("error" in preview) ? preview : null;
  const final = base == null ? null : discountOk ? discountOk.final : base;
  const paidNow = pay.amount.trim() === "" ? 0 : Number(pay.amount);
  const method: Method = pay.method || (f.channel === "GATHERN" ? "GATHERN" : "BANK_TRANSFER");
  const payError = paidNow < 0 || !Number.isFinite(paidNow) ? "أدخل مبلغًا صحيحًا" : final != null && paidNow > final ? "المبلغ المستلم أكبر من السعر النهائي" : null;
  const remaining = final == null ? null : r2(final - paidNow);
  const guestName = guest?.name ?? f.name.trim();

  const ready = Boolean(quote?.available) && (guest || (f.name.trim() && f.phone.trim())) && !discountError && !(disc.on && disc.value.trim() !== "" && !discountOk) && !payError;

  async function submit() {
    const r = await m.run<{ id: string }>("/api/admin/bookings", "POST", {
      channel: f.channel,
      startDate: firstDay,
      nights,
      dates: mode === "SEPARATE" ? days : null,
      resourceIds: f.resourceIds,
      ...(guest
        ? {
            guestId: guest.id,
            // Only details missing from the saved record are sent.
            phone: !guest.phone && f.phone.trim() ? f.phone : null,
            nationalId: !guest.nationalIdMasked && f.nationalId.trim() ? f.nationalId.trim() : null,
          }
        : { name: f.name, nationalId: f.nationalId.trim() || null, phone: f.phone }),
      guestCount: f.guestCount ? Number(f.guestCount) : null,
      adminNotes: f.adminNotes || null,
      paymentPlan: f.paymentPlan,
      depositTiming: f.depositTiming,
      // Empty = the deposit from settings; 0 = no security deposit (e.g. paid through Gathern).
      securityDeposit: f.securityDeposit === "" ? null : Number(f.securityDeposit),
      manualDiscount: discountOk && discountOk.amount > 0 ? { type: disc.type, value: Number(disc.value) } : null,
      initialPayment: paidNow > 0 ? { amount: paidNow, method } : null,
    });
    if (r) navigate(`/admin/bookings/${r.id}`);
  }

  return (
    <>
      <PageTitle title="حجز يدوي / جاذر إن" />

      <Section n={1} title="بيانات العميل">
        {guest ? (
          <div className="rounded-xl border border-jood-green/15 bg-jood-beige/50 p-3 text-sm" aria-label="العميل المختار">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                <span className="font-medium">{guest.name}</span>
                <span className="ms-2 text-xs text-jood-ink/60">عميل سابق · حجوزات: {guest.bookingCount}</span>
              </p>
              <Button variant="ghost" onClick={() => { setGuest(null); setF({ ...f, name: "", phone: "", nationalId: "" }); }}>تغيير العميل</Button>
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-jood-ink/75 sm:grid-cols-2">
              <div>الجوال: <span dir="ltr">{guest.phone ? `+${guest.phone}` : "غير مسجل"}</span></div>
              <div>الهوية / الإقامة: <span dir="ltr">{guest.nationalIdMasked ?? "غير مسجلة"}</span></div>
              {guest.email && <div>البريد: <span dir="ltr">{guest.email}</span></div>}
              {guest.notes && <div className="sm:col-span-2">ملاحظات: {guest.notes}</div>}
            </dl>
            {(!guest.phone || !guest.nationalIdMasked) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {!guest.phone && (
                  <Field label="الجوال (واتساب) — غير مسجل، يُحفظ للعميل">
                    <input type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={`${inputClass} text-end`} placeholder="05xxxxxxxx" />
                  </Field>
                )}
                {!guest.nationalIdMasked && (
                  <Field label="رقم الهوية أو الإقامة (اختياري) — يُحفظ للعميل">
                    <input inputMode="numeric" dir="ltr" maxLength={10} value={f.nationalId} onChange={(e) => setF({ ...f, nationalId: e.target.value })} className={`${inputClass} text-end`} />
                  </Field>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <GuestAutocomplete value={f.name} onChange={(name) => setF({ ...f, name })} onPick={(g) => { setGuest(g); setF({ ...f, name: g.name, phone: "", nationalId: "" }); }} />
            </div>
            <Field label="الجوال (واتساب)">
              <input type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={`${inputClass} text-end`} placeholder="05xxxxxxxx" />
            </Field>
            <Field label="رقم الهوية أو الإقامة (اختياري)">
              <input inputMode="numeric" dir="ltr" maxLength={10} value={f.nationalId} onChange={(e) => setF({ ...f, nationalId: e.target.value })} className={`${inputClass} text-end`} />
            </Field>
          </div>
        )}
      </Section>

      <Section n={2} title="تفاصيل الحجز">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-wrap gap-2 md:col-span-3" role="radiogroup" aria-label="طريقة اختيار الأيام">
            {([["RANGE", "أيام متتالية"], ["SEPARATE", "أيام متفرقة"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={`rounded-full border px-4 py-1.5 text-sm ${mode === k ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                {l}
              </button>
            ))}
          </div>
          {mode === "SEPARATE" ? (
            <div className="md:col-span-3">
              <DayChips days={days} onChange={setDays} />
              {days.length > 30 && <p className="mt-2 text-sm text-red-800">أقصى عدد 30 يومًا</p>}
            </div>
          ) : (
            <>
            <Field label="تاريخ الدخول">
              <input type="date" value={f.startDate} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </Field>
            <Field label="تاريخ الخروج">
              <input type="date" value={f.endDate} min={f.startDate ? addDays(f.startDate, 1) : undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={inputClass} />
            </Field>
            <div>
              <p className="text-sm font-medium text-jood-ink/80">عدد الأيام</p>
              <p className="mt-1 rounded-xl bg-jood-beige/60 px-4 py-2.5 font-semibold" aria-label="عدد الأيام">
                {f.startDate && f.endDate ? (datesOk ? `${nights} ${nights === 1 ? "يوم" : nights === 2 ? "يومان" : nights <= 10 ? "أيام" : "يومًا"}` : "—") : "—"}
              </p>
            </div>
            {f.startDate && f.endDate && !datesOk && (
              <p className="text-sm text-red-800 md:col-span-3">{nights < 1 ? "تاريخ الخروج يجب أن يكون بعد تاريخ الدخول" : "أقصى مدة 30 يومًا"}</p>
            )}
            </>
          )}
          <fieldset className="md:col-span-3">
            <legend className="text-sm font-medium text-jood-ink/80">نوع الحجز</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {resources.map((r) => (
                <label key={r.id} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm ${f.resourceIds.includes(r.id) ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                  <input type="checkbox" className="sr-only" checked={f.resourceIds.includes(r.id)} onChange={() => toggle(r.id, r.kind)} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="المصدر">
            <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as "GATHERN" | "MANUAL" })} className={inputClass}>
              <option value="GATHERN">جاذر إن</option>
              <option value="MANUAL">يدوي (هاتف أو مباشر)</option>
            </select>
          </Field>
          <Field label="ملاحظات (اختياري)" hint="مثل رقم الحجز في جاذر إن" className="md:col-span-2">
            <input value={f.adminNotes} onChange={(e) => setF({ ...f, adminNotes: e.target.value })} className={inputClass} />
          </Field>
          {quote && !quote.available && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-3">{quote.reason}</p>}
        </div>
      </Section>

      <Section n={3} title="السعر والدفع">
        {base == null ? (
          <p className="text-sm text-jood-ink/60">اختر التواريخ ونوع الحجز ليظهر السعر.</p>
        ) : (
          <div className="space-y-4">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>السعر الأساسي</dt><dd aria-label="السعر الأساسي">{money(base)}</dd></div>
            </dl>

            {!disc.on ? (
              <Button variant="ghost" onClick={() => setDisc({ ...disc, on: true })}>+ إضافة خصم</Button>
            ) : (
              <div className="rounded-xl border border-jood-green/15 p-3" role="group" aria-label="الخصم">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="نوع الخصم">
                    <select value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value as DiscountType, value: "" })} className={inputClass}>
                      <option value="FIXED">مبلغ ثابت (ريال)</option>
                      <option value="PERCENT">نسبة مئوية (%)</option>
                      <option value="FINAL_PRICE">سعر نهائي متفق عليه</option>
                    </select>
                  </Field>
                  <Field label={disc.type === "FIXED" ? "مبلغ الخصم (ريال)" : disc.type === "PERCENT" ? "نسبة الخصم (%)" : "السعر النهائي (ريال)"}>
                    <input type="number" min={0} step="0.01" inputMode="decimal" value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} className={inputClass} />
                  </Field>
                  <Button variant="ghost" onClick={() => setDisc({ on: false, type: "FIXED", value: "" })}>إزالة الخصم</Button>
                </div>
                {discountError && <p className="mt-2 text-sm text-red-800" role="alert">{discountError}</p>}
                {discountOk && (
                  <p className="mt-2 text-sm text-emerald-800">
                    الخصم {money(discountOk.amount)} ({discountOk.percent}%)
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-between rounded-xl bg-jood-green/5 px-4 py-3 font-semibold text-jood-green">
              <span>السعر النهائي</span>
              <span aria-label="السعر النهائي">{money(final!)}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="المبلغ المستلم الآن (اختياري)" hint="يُسجّل كدفعة متحقق منها. اتركه فارغًا إن لم يُستلم شيء.">
                <input type="number" min={0} step="0.01" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className={inputClass} />
              </Field>
              {paidNow > 0 && (
                <Field label="طريقة الاستلام">
                  <select value={method} onChange={(e) => setPay({ ...pay, method: e.target.value as Method })} className={inputClass}>
                    <option value="BANK_TRANSFER">تحويل بنكي</option>
                    <option value="CASH">نقدًا</option>
                    <option value="GATHERN">عبر جاذر إن</option>
                  </select>
                </Field>
              )}
            </div>
            {payError && <p className="text-sm text-red-800" role="alert">{payError}</p>}

            <details className="rounded-xl border border-jood-green/10 p-3 text-sm">
              <summary className="cursor-pointer text-jood-ink/75">خيارات متقدمة (طريقة السداد، التأمين، عدد الضيوف)</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <Field label="طريقة السداد">
                  <select value={f.paymentPlan} onChange={(e) => setF({ ...f, paymentPlan: e.target.value as typeof f.paymentPlan })} className={inputClass}>
                    <option value="FULL">كامل المبلغ مقدمًا</option>
                    <option value="DEPOSIT">عربون والباقي قبل الدخول</option>
                  </select>
                </Field>
                <Field label="مبلغ التأمين (ريال)" hint={`فارغ = المبلغ في الإعدادات (${money(quote?.available ? quote.deposit : 0)})، أو 0 بلا تأمين`}>
                  <input type="number" min={0} step="0.01" value={f.securityDeposit} onChange={(e) => setF({ ...f, securityDeposit: e.target.value })} className={inputClass} />
                </Field>
                <Field label="سداد التأمين">
                  <select value={f.depositTiming} onChange={(e) => setF({ ...f, depositTiming: e.target.value as typeof f.depositTiming })} className={inputClass}>
                    <option value="WITH_FIRST_PAYMENT">مع الدفعة الأولى</option>
                    <option value="BEFORE_CHECKIN">قبل الدخول</option>
                  </select>
                </Field>
                <Field label="عدد الضيوف (اختياري)">
                  <input type="number" min={1} value={f.guestCount} onChange={(e) => setF({ ...f, guestCount: e.target.value })} className={inputClass} />
                </Field>
              </div>
            </details>
          </div>
        )}
      </Section>

      <Section n={4} title="تأكيد">
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" aria-label="ملخص الحجز">
          <Row k="العميل" v={guestName || "—"} />
          <Row k={mode === "SEPARATE" ? "الأيام" : "الفترة"} v={!datesOk ? "—" : mode === "SEPARATE" ? days.map(dayLabel).join("، ") : `${dayLabel(f.startDate)} ← ${dayLabel(f.endDate)}`} />
          <Row k="عدد الأيام" v={datesOk ? String(nights) : "—"} />
          <Row k="نوع الحجز" v={resources.filter((r) => f.resourceIds.includes(r.id)).map((r) => r.name).join("، ") || "—"} />
          <Row k="السعر الأساسي" v={base == null ? "—" : money(base)} />
          <Row k="الخصم" v={discountOk && discountOk.amount > 0 ? `${money(discountOk.amount)} (${discountOk.percent}% · ${DISCOUNT_LABEL[disc.type]})` : "لا يوجد"} />
          <Row k="السعر النهائي" v={final == null ? "—" : money(final)} strong />
          <Row k="حالة الدفع" v={final == null ? "—" : paidNow <= 0 ? `غير مدفوع — المتبقي ${money(final)}` : remaining! <= 0 ? "مدفوع بالكامل" : `مدفوع ${money(paidNow)} — المتبقي ${money(remaining!)}`} />
        </dl>
        {quote?.available && <p className="mt-3 text-xs text-jood-ink/60">التأمين المسترد يُحسب منفصلًا عن سعر الحجز. لا تُضاف رسوم جاذر إن.</p>}
        <div className="mt-5">
          <ErrorNote>{m.error}</ErrorNote>
          <Button className="mt-3 w-full sm:w-auto" busy={m.busy} disabled={!ready} onClick={submit}>
            حفظ الحجز
          </Button>
        </div>
      </Section>
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 border-b border-jood-green/5 py-1 ${strong ? "font-semibold text-jood-green" : ""}`}>
      <dt className="text-jood-ink/60">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

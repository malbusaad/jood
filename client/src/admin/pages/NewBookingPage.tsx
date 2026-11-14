import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import type { ResourceRef } from "../types";
import { Button, Card, ErrorNote, Field, PageTitle, inputClass, money, useApi, useMutation } from "../ui";
import GuestAutocomplete, { type SuggestedGuest } from "./GuestAutocomplete";

type Q = { available: true; total: number; deposit: number } | { available: false; reason: string };

/** Records a booking made outside the website (Gathern, phone). Same conflict rules as the website. */
export default function NewBookingPage() {
  const navigate = useNavigate();
  const { data } = useApi<{ resources: (ResourceRef & { active: boolean })[] }>("/api/admin/resources");
  const m = useMutation();
  const [f, setF] = useState({ channel: "GATHERN" as "GATHERN" | "MANUAL", startDate: "", nights: 1, resourceIds: [] as string[], name: "", nationalId: "", phone: "", guestCount: "", adminNotes: "", paymentPlan: "FULL" as "FULL" | "DEPOSIT", depositTiming: "WITH_FIRST_PAYMENT" as "WITH_FIRST_PAYMENT" | "BEFORE_CHECKIN", securityDeposit: "" });
  const [quote, setQuote] = useState<Q | null>(null);
  /** A returning customer chosen from the suggestions (the booking is linked to their record). */
  const [guest, setGuest] = useState<SuggestedGuest | null>(null);

  const resources = data?.resources.filter((r) => r.active) ?? [];

  useEffect(() => {
    if (!f.startDate || f.resourceIds.length === 0) return setQuote(null);
    let cancelled = false;
    api<Q>("/api/admin/bookings/quote", { method: "POST", body: JSON.stringify({ resourceIds: f.resourceIds, startDate: f.startDate, nights: f.nights }) })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [f.startDate, f.nights, f.resourceIds]);

  function toggle(id: string, kind: string) {
    setF((s) => {
      if (kind === "FULL") return { ...s, resourceIds: s.resourceIds.includes(id) ? [] : [id] };
      const fullIds = resources.filter((r) => r.kind === "FULL").map((r) => r.id);
      const rest = s.resourceIds.filter((x) => !fullIds.includes(x));
      return { ...s, resourceIds: rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id] };
    });
  }

  async function submit() {
    const r = await m.run<{ id: string }>("/api/admin/bookings", "POST", {
      channel: f.channel,
      startDate: f.startDate,
      nights: f.nights,
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
    });
    if (r) navigate(`/admin/bookings/${r.id}`);
  }

  return (
    <>
      <PageTitle title="حجز يدوي / جاذر إن" />
      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="المصدر">
            <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as "GATHERN" | "MANUAL" })} className={inputClass}>
              <option value="GATHERN">جاذر إن</option>
              <option value="MANUAL">يدوي (هاتف أو مباشر)</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الدخول">
              <input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={inputClass} />
            </Field>
            <Field label="عدد الأيام">
              <input type="number" min={1} max={30} value={f.nights} onChange={(e) => setF({ ...f, nights: Math.max(1, Number(e.target.value) || 1) })} className={inputClass} />
            </Field>
          </div>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium text-jood-ink/80">المحجوز</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {resources.map((r) => (
                <label key={r.id} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm ${f.resourceIds.includes(r.id) ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                  <input type="checkbox" className="sr-only" checked={f.resourceIds.includes(r.id)} onChange={() => toggle(r.id, r.kind)} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          {quote && (
            <p className={`rounded-xl px-4 py-3 text-sm md:col-span-2 ${quote.available ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
              {quote.available ? `متاح — مبلغ الحجز ${money(quote.total)} + تأمين ${money(quote.deposit)}. لا تُضاف رسوم جاذر إن.` : quote.reason}
            </p>
          )}
          {guest ? (
            <div className="rounded-xl border border-jood-green/15 bg-jood-beige/50 p-3 text-sm md:col-span-2" aria-label="العميل المختار">
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
            <>
              <GuestAutocomplete value={f.name} onChange={(name) => setF({ ...f, name })} onPick={(g) => { setGuest(g); setF({ ...f, name: g.name, phone: "", nationalId: "" }); }} />
              <Field label="رقم الهوية أو الإقامة (اختياري)">
                <input inputMode="numeric" dir="ltr" maxLength={10} value={f.nationalId} onChange={(e) => setF({ ...f, nationalId: e.target.value })} className={`${inputClass} text-end`} />
              </Field>
              <Field label="الجوال (واتساب)">
                <input type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={`${inputClass} text-end`} placeholder="05xxxxxxxx" />
              </Field>
            </>
          )}
          <Field label="طريقة السداد">
            <select value={f.paymentPlan} onChange={(e) => setF({ ...f, paymentPlan: e.target.value as typeof f.paymentPlan })} className={inputClass}>
              <option value="FULL">كامل المبلغ مقدمًا</option>
              <option value="DEPOSIT">عربون والباقي قبل الدخول</option>
            </select>
          </Field>
          <Field label="مبلغ التأمين (ريال)" hint="اتركه فارغًا لاستخدام المبلغ في الإعدادات، أو 0 بلا تأمين">
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
          <Field label="ملاحظات داخلية" hint="مثل رقم الحجز في جاذر إن">
            <input value={f.adminNotes} onChange={(e) => setF({ ...f, adminNotes: e.target.value })} className={inputClass} />
          </Field>
        </div>
        <div className="mt-5">
          <ErrorNote>{m.error}</ErrorNote>
          <Button className="mt-3" busy={m.busy} disabled={!quote?.available || (!guest && (!f.name || !f.phone))} onClick={submit}>
            إنشاء الحجز
          </Button>
        </div>
      </Card>
    </>
  );
}

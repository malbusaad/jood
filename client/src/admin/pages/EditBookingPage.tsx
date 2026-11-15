import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { api } from "../../api/client";
import type { BookingDetail, ResourceRef } from "../types";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, StatusBadge, dayLabel, inputClass, money, useApi, useMutation } from "../ui";
import { DISCOUNT_LABEL, previewDiscount, r2, type DiscountType } from "../manualDiscount";
import DayChips from "./DayChips";

type Q = { available: true; total: number } | { available: false; reason: string };
const EDITABLE = ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"];

/** «تعديل الحجز»: page wrapper — loads the booking, then the form. */
export default function EditBookingPage() {
  const { id } = useParams();
  const { data: b, error, loading } = useApi<BookingDetail>(`/api/admin/bookings/${id}`);
  if (loading && !b) return <Loading />;
  if (!b) return <ErrorNote>{error}</ErrorNote>;
  if (!EDITABLE.includes(b.status)) return <ErrorNote>{`لا يمكن تعديل حجز حالته «${b.statusLabel}»`}</ErrorNote>;
  return <EditForm b={b} />;
}

function EditForm({ b }: { b: BookingDetail }) {
  const navigate = useNavigate();
  const m = useMutation();
  const { data } = useApi<{ resources: (ResourceRef & { active: boolean })[] }>("/api/admin/resources");
  const resources = data?.resources.filter((r) => r.active || b.items.some((i) => i.resource.id === r.id)) ?? [];

  const origDays = [...new Set(b.items.map((i) => i.date.slice(0, 10)))].sort();
  const origRes = [...new Set(b.items.map((i) => i.resource.id))].sort();
  const [days, setDays] = useState(origDays);
  const [resourceIds, setResourceIds] = useState(origRes);
  const [disc, setDisc] = useState({
    on: Boolean(b.manualDiscountType),
    type: (b.manualDiscountType ?? "FIXED") as DiscountType,
    value: b.manualDiscountValue ? String(Number(b.manualDiscountValue)) : "",
  });
  /** A website discount code is kept as it is unless the owner replaces or removes it. */
  const [keepCode, setKeepCode] = useState(Boolean(b.discountCode) && Number(b.discountAmount ?? 0) > 0);
  const [f, setF] = useState({
    securityDeposit: String(Number(b.depositAmount)),
    paymentPlan: (b.payment?.plan ?? "FULL") as "FULL" | "DEPOSIT",
    depositTiming: (b.payment?.depositTiming ?? "WITH_FIRST_PAYMENT") as "WITH_FIRST_PAYMENT" | "BEFORE_CHECKIN",
    guestCount: b.guestCount ? String(b.guestCount) : "",
    adminNotes: b.adminNotes ?? "",
  });
  const [quote, setQuote] = useState<Q | null>(null);

  const stayChanged = days.join() !== origDays.join() || [...resourceIds].sort().join() !== origRes.join();
  const daysKey = days.join(",");
  const resKey = resourceIds.join(",");
  useEffect(() => {
    if (!stayChanged || days.length === 0 || resourceIds.length === 0) return setQuote(null);
    let cancelled = false;
    api<Q>("/api/admin/bookings/quote", { method: "POST", body: JSON.stringify({ resourceIds, startDate: days[0], nights: days.length, dates: days, bookingId: b.id }) })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayChanged, daysKey, resKey, b.id]);

  function toggle(id: string, kind: string) {
    if (kind === "FULL") return setResourceIds(resourceIds.includes(id) ? [] : [id]);
    const fullIds = resources.filter((r) => r.kind === "FULL").map((r) => r.id);
    const rest = resourceIds.filter((x) => !fullIds.includes(x));
    setResourceIds(rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id]);
  }

  // ---- price ----
  const oldBase = Number(b.totalAmount) + Number(b.discountAmount ?? 0);
  const base = stayChanged ? (quote?.available ? quote.total : null) : oldBase;
  const preview = base != null && disc.on ? previewDiscount(base, disc.type, disc.value) : null;
  const discountError = preview && "error" in preview ? preview.error : null;
  const discountOk = preview && !("error" in preview) ? preview : null;
  const codeAmount = keepCode ? Number(b.discountAmount) : 0;
  const discount = discountOk ? discountOk.amount : codeAmount;
  const final = base == null ? null : r2(base - discount);
  const codeTooBig = keepCode && base != null && codeAmount > base;
  const paid = Number(b.paid);
  const remaining = final == null ? null : r2(final - paid);
  const deposit = f.securityDeposit === "" ? NaN : Number(f.securityDeposit);

  const ready = days.length >= 1 && days.length <= 30 && resourceIds.length > 0 && base != null && !discountError && !(disc.on && !discountOk) && !codeTooBig && Number.isFinite(deposit) && deposit >= 0;

  async function save() {
    const body: Record<string, unknown> = {
      securityDeposit: deposit,
      paymentPlan: f.paymentPlan,
      depositTiming: f.depositTiming,
      guestCount: f.guestCount ? Number(f.guestCount) : null,
      adminNotes: f.adminNotes.trim() || null,
    };
    if (stayChanged) Object.assign(body, { dates: days, resourceIds });
    if (discountOk && discountOk.amount > 0) body.manualDiscount = { type: disc.type, value: Number(disc.value) };
    else if (!keepCode) body.manualDiscount = null;
    const r = await m.run<{ overpaid: string | null }>(`/api/admin/bookings/${b.id}/edit`, "POST", body);
    if (r) navigate(`/admin/bookings/${b.id}`);
  }

  return (
    <>
      <Link to={`/admin/bookings/${b.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-jood-green">
        <ArrowRight aria-hidden className="size-4" /> العودة للحجز
      </Link>
      <PageTitle title={`تعديل الحجز ${b.reference}`}>
        <StatusBadge status={b.status} />
      </PageTitle>
      <p className="mb-4 text-sm text-jood-ink/65">
        العميل: <span className="font-medium">{b.guest.name}</span> ·{" "}
        <Link to={`/admin/guests/${b.guest.id}`} className="text-jood-green underline">تعديل بيانات العميل</Link>
        {" "}· الدفعات المسجلة تبقى كما هي، ويُحفظ التعديل في سجل الحجز.
      </p>

      <Card title="الأيام ونوع الحجز" className="mb-4">
        <DayChips days={days} onChange={setDays} />
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-jood-ink/80">نوع الحجز</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {resources.map((r) => (
              <label key={r.id} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm ${resourceIds.includes(r.id) ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                <input type="checkbox" className="sr-only" checked={resourceIds.includes(r.id)} onChange={() => toggle(r.id, r.kind)} />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        {stayChanged && quote && !quote.available && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{quote.reason}</p>}
        {days.length > 30 && <p className="mt-2 text-sm text-red-800">أقصى عدد 30 يومًا</p>}
      </Card>

      <Card title="السعر" className="mb-4">
        {base == null ? (
          <p className="text-sm text-jood-ink/60">{days.length === 0 || resourceIds.length === 0 ? "اختر الأيام ونوع الحجز ليظهر السعر." : "جارٍ حساب السعر…"}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span>السعر الأساسي{stayChanged ? " (حسب الأيام الجديدة)" : ""}</span><span aria-label="السعر الأساسي">{money(base)}</span></div>
            {keepCode && !disc.on && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-700">
                <span>خصم الكود <span dir="ltr">{b.discountCode}</span>: − {money(codeAmount)}</span>
                <Button variant="ghost" onClick={() => setKeepCode(false)}>إزالة خصم الكود</Button>
              </div>
            )}
            {codeTooBig && <p className="text-red-800" role="alert">خصم الكود أكبر من السعر الجديد؛ أزله أو ضع خصمًا يدويًا.</p>}
            {!disc.on ? (
              <Button variant="ghost" onClick={() => { setDisc({ ...disc, on: true }); setKeepCode(false); }}>{keepCode ? "استبدال بخصم يدوي" : "+ إضافة خصم"}</Button>
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
                {discountError && <p className="mt-2 text-red-800" role="alert">{discountError}</p>}
                {discountOk && <p className="mt-2 text-emerald-800">الخصم {money(discountOk.amount)} ({discountOk.percent}% · {DISCOUNT_LABEL[disc.type]})</p>}
              </div>
            )}
            <dl className="space-y-1 rounded-xl bg-jood-green/5 px-4 py-3" aria-label="الأثر على الدفع">
              <div className="flex justify-between"><dt>السعر الحالي</dt><dd>{money(b.totalAmount)}</dd></div>
              <div className="flex justify-between font-semibold text-jood-green"><dt>السعر الجديد</dt><dd aria-label="السعر الجديد">{final == null ? "—" : money(final)}</dd></div>
              <div className="flex justify-between"><dt>المدفوع (متحقق منه)</dt><dd>{money(paid)}</dd></div>
              {remaining != null && (remaining >= 0
                ? <div className="flex justify-between"><dt>المتبقي بعد التعديل</dt><dd className={remaining > 0 ? "text-amber-800" : "text-emerald-700"}>{money(remaining)}</dd></div>
                : <p className="text-amber-800" role="status">المدفوع أكثر من السعر الجديد بـ {money(-remaining)} — سجّل استردادًا من صفحة الحجز بعد الحفظ.</p>)}
            </dl>
          </div>
        )}
      </Card>

      <Card title="تفاصيل أخرى" className="mb-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="مبلغ التأمين (ريال)">
            <input type="number" min={0} step="0.01" value={f.securityDeposit} onChange={(e) => setF({ ...f, securityDeposit: e.target.value })} className={inputClass} />
          </Field>
          <Field label="طريقة السداد">
            <select value={f.paymentPlan} onChange={(e) => setF({ ...f, paymentPlan: e.target.value as typeof f.paymentPlan })} className={inputClass}>
              <option value="FULL">كامل المبلغ مقدمًا</option>
              <option value="DEPOSIT">عربون والباقي قبل الدخول</option>
            </select>
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
          <Field label="ملاحظات داخلية" className="md:col-span-2">
            <input value={f.adminNotes} onChange={(e) => setF({ ...f, adminNotes: e.target.value })} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card>
        <p className="text-sm text-jood-ink/70">
          {days.length} {days.length === 1 ? "يوم" : "أيام"}: {days.map(dayLabel).join("، ") || "—"}
          {b.status === "CONFIRMED" && stayChanged && " · يُحدَّث رقم الباب ومواعيد الرسائل تلقائيًا."}
        </p>
        <ErrorNote>{m.error}</ErrorNote>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={m.busy} disabled={!ready} onClick={save}>حفظ التعديلات</Button>
          <Link to={`/admin/bookings/${b.id}`} className="rounded-xl px-4 py-2 text-sm text-jood-green hover:bg-jood-green/5">إلغاء</Link>
        </div>
      </Card>
    </>
  );
}

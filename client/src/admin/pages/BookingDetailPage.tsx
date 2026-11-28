import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Pencil, Printer, Trash2 } from "lucide-react";
import type { BookingDetail, BookingStatus, PaymentMethod, PaymentPurpose } from "../types";
import { ACTION_LABEL, CHANNEL, DEPOSIT_STATUS, DEPOSIT_TIMING, METHOD, PAYMENT_STATUS, PLAN, PURPOSE, STATUS } from "../labels";
import { useUser } from "../auth";
import { formatDateAr } from "../../lib/format";
import ContractFlowCard from "./ContractFlowCard";
import DeleteBookingCard from "./DeleteBookingCard";
import { DISCOUNT_LABEL, r2 } from "../manualDiscount";
import DoorCodeCard from "./DoorCodeCard";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, StatusBadge, dateTime, inputClass, money, nightsBetween, useApi, useMutation } from "../ui";

const HISTORY_LABEL: Record<string, string> = {
  "booking.create": "أُنشئ الحجز",
  "booking.status": "تغيير الحالة",
  "booking.update": "تعديل",
  "booking.edit": "تعديل الحجز (الأيام أو السعر)",
  "payment.update": "تصحيح دفعة",
  "payment.delete": "حذف دفعة",
};

export default function BookingDetailPage() {
  const { id } = useParams();
  const { data: b, error, loading, reload } = useApi<BookingDetail>(`/api/admin/bookings/${id}`);
  const m = useMutation();
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState<{ method: PaymentMethod; purpose: PaymentPurpose; amount: string; externalRef: string; note: string }>({ method: "BANK_TRANSFER", purpose: "BOOKING", amount: "", externalRef: "", note: "" });
  const [refund, setRefund] = useState<{ purpose: PaymentPurpose; method: PaymentMethod; amount: string; note: string } | null>(null);
  const owner = useUser().role === "OWNER";
  const [notes, setNotes] = useState<string | null>(null);
  /** A payment being corrected (owner only). */
  const [fix, setFix] = useState<{ id: string; amount: string; method: PaymentMethod } | null>(null);

  if (loading && !b) return <Loading />;
  if (!b) return <ErrorNote>{error ?? "الحجز غير موجود"}</ErrorNote>;

  const days = nightsBetween(b.startDate, b.endDate);
  const total = Number(b.totalAmount);
  const deposit = Number(b.depositAmount);
  const paid = Number(b.paid);
  const ps = b.payment;
  const resources = [...new Map(b.items.map((i) => [i.resource.id, i.resource])).values()];
  const active = ["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"].includes(b.status);

  async function setStatus(status: BookingStatus) {
    if ((status === "CANCELLED" || status === "REJECTED") && !confirm(`${ACTION_LABEL[status]}؟ سيُتاح الموعد لغيره.`)) return;
    const r = await m.run(`/api/admin/bookings/${b!.id}/status`, "POST", { status, reason: reason || null });
    if (r) {
      setReason("");
      reload();
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (await m.run(`/api/admin/bookings/${b!.id}`, "PATCH", body)) reload();
  }

  async function recordPayment() {
    const amount = Number(pay.amount);
    if (!amount) return m.setError("أدخل المبلغ");
    const r = await m.run(`/api/admin/bookings/${b!.id}/payments`, "POST", {
      method: pay.method,
      purpose: pay.purpose,
      amount,
      externalRef: pay.externalRef || null,
      note: pay.note || null,
    });
    if (r) {
      setPay({ method: "BANK_TRANSFER", purpose: "BOOKING", amount: "", externalRef: "", note: "" });
      reload();
    }
  }

  async function recordRefund() {
    if (!refund || !Number(refund.amount)) return m.setError("أدخل مبلغ الاسترداد");
    if (!confirm(`تسجيل استرداد ${refund.amount} ريال من ${PURPOSE[refund.purpose]}؟`)) return;
    const r = await m.run(`/api/admin/bookings/${b!.id}/refunds`, "POST", { ...refund, amount: Number(refund.amount), note: refund.note || null });
    if (r) {
      setRefund(null);
      reload();
    }
  }

  async function reviewPayment(paymentId: string, action: "accept" | "reject") {
    if (await m.run(`/api/admin/bookings/payments/${paymentId}/${action}`, "POST", {})) reload();
  }

  return (
    <>
      <Link to="/admin/bookings" className="mb-3 inline-flex items-center gap-1 text-sm text-jood-green print:hidden">
        <ArrowRight aria-hidden className="size-4" /> الحجوزات
      </Link>
      <PageTitle title={`حجز ${b.reference}`}>
        <StatusBadge status={b.status} />
        {["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED"].includes(b.status) && (
          <Link to={`/admin/bookings/${b.id}/edit`} className="inline-flex items-center gap-1 rounded-xl border border-jood-green/25 px-3 py-1.5 text-sm text-jood-green hover:bg-jood-green/5 print:hidden">
            <Pencil aria-hidden className="size-4" /> تعديل الحجز
          </Link>
        )}
        <Button variant="ghost" onClick={() => window.print()} className="print:hidden">
          <Printer aria-hidden className="size-4" /> طباعة
        </Button>
      </PageTitle>
      <ErrorNote>{m.error}</ErrorNote>

      <div className="mt-4 grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <Card title="الضيف">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-jood-ink/55">الاسم</dt><dd className="font-medium"><Link to={`/admin/guests/${b.guest.id}`} className="underline decoration-jood-gold/50">{b.guest.name}</Link></dd></div>
              <div><dt className="text-jood-ink/55">الجوال / واتساب</dt><dd dir="ltr" className="text-end sm:text-start">{b.guest.phone ? <a href={`tel:+${b.guest.phone}`}>+{b.guest.phone}</a> : <span dir="rtl" className="text-amber-700">غير مسجل</span>}</dd></div>
              <div><dt className="text-jood-ink/55">رقم الهوية / الإقامة</dt><dd dir="ltr" className="text-end sm:text-start">{b.guest.nationalId ?? <span className="text-amber-700">غير مسجل</span>}</dd></div>
              {b.guest.email && <div><dt className="text-jood-ink/55">البريد</dt><dd dir="ltr" className="text-end sm:text-start">{b.guest.email}</dd></div>}
              {b.guestCount && <div><dt className="text-jood-ink/55">عدد الضيوف</dt><dd>{b.guestCount}</dd></div>}
              {b.guestNotes && <div className="sm:col-span-2"><dt className="text-jood-ink/55">ملاحظات الضيف</dt><dd className="whitespace-pre-line">{b.guestNotes}</dd></div>}
            </dl>
          </Card>

          <Card title="الحجز">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-jood-ink/55">الدخول</dt><dd>{formatDateAr(b.startDate)}</dd></div>
              <div><dt className="text-jood-ink/55">الخروج</dt><dd>{formatDateAr(b.endDate)}</dd></div>
              <div><dt className="text-jood-ink/55">عدد الأيام</dt><dd>{days}</dd></div>
              <div><dt className="text-jood-ink/55">المصدر</dt><dd>{CHANNEL[b.channel]}</dd></div>
              <div className="sm:col-span-2"><dt className="text-jood-ink/55">المحجوز</dt><dd>{resources.map((r) => r.name).join("، ")}</dd></div>
              <div><dt className="text-jood-ink/55">تاريخ الطلب</dt><dd>{dateTime(b.createdAt)}</dd></div>
              {b.expiresAt && <div><dt className="text-jood-ink/55">مهلة الدفع تنتهي</dt><dd className="text-amber-800">{dateTime(b.expiresAt)}</dd></div>}
              {b.confirmedAt && <div><dt className="text-jood-ink/55">أُكّد</dt><dd>{dateTime(b.confirmedAt)}{b.confirmedBy ? ` — ${b.confirmedBy.name}` : ""}</dd></div>}
              {b.cancelledAt && <div><dt className="text-jood-ink/55">أُلغي</dt><dd>{dateTime(b.cancelledAt)}{b.cancelReason ? ` — ${b.cancelReason}` : ""}</dd></div>}
            </dl>
            <table className="mt-4 w-full text-sm">
              <thead><tr className="text-jood-ink/55"><th className="py-1 text-start font-normal">اليوم</th><th className="py-1 text-start font-normal">البند</th><th className="py-1 text-end font-normal">السعر</th></tr></thead>
              <tbody>
                {b.priceBreakdown.map((l) => (
                  <tr key={`${l.date}-${l.resourceId}`} className="border-t border-jood-green/10">
                    <td className="py-1.5">{formatDateAr(l.date)}</td>
                    <td className="py-1.5">{l.resourceName}</td>
                    <td className="py-1.5 text-end">{money(l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 space-y-1 border-t border-jood-green/10 pt-3 text-sm">
              {Number(b.discountAmount ?? 0) > 0 && (
                <>
                  <div className="flex justify-between text-jood-ink/65"><dt>السعر الأساسي (قبل الخصم)</dt><dd>{money(total + Number(b.discountAmount))}</dd></div>
                  <div className="flex justify-between text-emerald-700">
                    <dt>
                      الخصم {b.discountCode ? <span dir="ltr">({b.discountCode})</span> : b.manualDiscountType ? `(${DISCOUNT_LABEL[b.manualDiscountType]}${b.manualDiscountType === "PERCENT" ? ` ${Number(b.manualDiscountValue)}%` : ""} — يدوي)` : null}
                      <span className="ms-1 text-xs">{r2((Number(b.discountAmount) / (total + Number(b.discountAmount))) * 100)}%</span>
                    </dt>
                    <dd>− {money(Number(b.discountAmount))}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between"><dt>{Number(b.discountAmount ?? 0) > 0 ? "مبلغ الحجز (السعر النهائي)" : "مبلغ الحجز"}</dt><dd>{money(total)}</dd></div>
              <div className="flex justify-between text-jood-ink/65"><dt>التأمين (مسترد)</dt><dd>{money(deposit)}</dd></div>
              <div className="flex justify-between font-semibold text-jood-green"><dt>الإجمالي المستحق</dt><dd>{money(total + deposit)}</dd></div>
              <div className="flex justify-between"><dt>المدفوع من مبلغ الحجز (متحقق منه)</dt><dd className={paid >= total ? "text-emerald-700" : "text-amber-800"}>{money(paid)}</dd></div>
              <div className="flex justify-between"><dt>المتبقي من مبلغ الحجز</dt><dd className={paid >= total ? "text-emerald-700" : "text-amber-800"}>{money(Math.max(0, total - paid))}</dd></div>
            </dl>
            {ps && !ps.legacy && (
              <dl className="mt-3 space-y-1 rounded-xl bg-jood-beige/60 p-3 text-sm" aria-label="حالة السداد">
                <div className="flex justify-between"><dt>طريقة السداد</dt><dd>{PLAN[ps.plan]}</dd></div>
                {ps.plan === "DEPOSIT" && <div className="flex justify-between"><dt>العربون المطلوب للتأكيد</dt><dd>{money(ps.upfrontAmount)}</dd></div>}
                <div className="flex justify-between"><dt>المتبقي من مبلغ الحجز</dt><dd className={Number(ps.bookingRemaining) > 0 ? "text-amber-800" : "text-emerald-700"}>{money(ps.bookingRemaining)}</dd></div>
                {Number(ps.securityDeposit) > 0 && (
                  <>
                    <div className="flex justify-between"><dt>التأمين ({DEPOSIT_TIMING[ps.depositTiming]})</dt><dd>{DEPOSIT_STATUS[ps.depositStatus]}</dd></div>
                    {Number(ps.depositRemaining) > 0 && <div className="flex justify-between"><dt>المتبقي من التأمين</dt><dd className="text-amber-800">{money(ps.depositRemaining)}</dd></div>}
                  </>
                )}
                {ps.balanceDueAt && !ps.fullySettled && <div className="flex justify-between text-jood-ink/65"><dt>آخر موعد لسداد المتبقي</dt><dd>{dateTime(ps.balanceDueAt)}</dd></div>}
                <div className={`flex justify-between font-medium ${ps.fullySettled ? "text-emerald-700" : "text-amber-800"}`}>
                  <dt>رمز الدخول للضيف</dt><dd>{ps.fullySettled ? "يظهر (السداد مكتمل)" : "مخفي حتى اكتمال السداد"}</dd>
                </div>
              </dl>
            )}
          </Card>

          <Card title="المدفوعات">
            {b.payments.length === 0 ? (
              <p className="text-sm text-jood-ink/60">لا توجد مدفوعات مسجلة.</p>
            ) : (
              <ul className="divide-y divide-jood-green/10 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium">{p.kind === "REFUND" ? "استرداد " : ""}{money(p.amount)}</span> · {PURPOSE[p.purpose ?? "BOOKING"]} · {METHOD[p.method]}
                      {p.externalRef && <span dir="ltr"> · {p.externalRef}</span>}
                      <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${p.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-900" : p.status === "REJECTED" ? "bg-stone-200" : "bg-orange-100 text-orange-900"}`}>{PAYMENT_STATUS[p.status]}</span>
                      <div className="text-xs text-jood-ink/55">
                        {p.verifiedAt ? `${p.status === "ACCEPTED" ? "تحقق" : "رُفض"} ${dateTime(p.verifiedAt)}${p.verifiedBy ? ` — ${p.verifiedBy.name}` : ""}` : `أُبلغ ${dateTime(p.createdAt)}`}
                        {p.note && ` · ${p.note}`}
                      </div>
                    </div>
                    {owner && fix?.id !== p.id && (
                      <div className="flex gap-1 print:hidden">
                        <Button variant="ghost" aria-label={`تعديل دفعة ${money(p.amount)}`} onClick={() => setFix({ id: p.id, amount: String(Number(p.amount)), method: p.method })}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" aria-label={`حذف دفعة ${money(p.amount)}`} busy={m.busy} onClick={async () => {
                          if (confirm(`حذف ${p.kind === "REFUND" ? "الاسترداد" : "الدفعة"} ${money(p.amount)}؟ يبقى سطر في سجل الحجز.`) && (await m.run(`/api/admin/bookings/payments/${p.id}`, "DELETE")) !== null) reload();
                        }}><Trash2 className="size-4 text-red-700" /></Button>
                      </div>
                    )}
                    {fix?.id === p.id && (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-jood-beige/60 p-2" role="group" aria-label="تصحيح الدفعة">
                        <input type="number" min={0.01} step="0.01" inputMode="decimal" value={fix.amount} onChange={(e) => setFix({ ...fix, amount: e.target.value })} aria-label="المبلغ الصحيح" className={`${inputClass} w-32`} />
                        <select value={fix.method} onChange={(e) => setFix({ ...fix, method: e.target.value as PaymentMethod })} aria-label="طريقة الدفع" className={`${inputClass} w-auto`}>
                          <option value="BANK_TRANSFER">تحويل بنكي</option>
                          <option value="CASH">نقدًا</option>
                          <option value="GATHERN">جاذر إن</option>
                        </select>
                        <Button busy={m.busy} disabled={!(Number(fix.amount) > 0)} onClick={async () => {
                          if (await m.run(`/api/admin/bookings/payments/${fix.id}`, "PATCH", { amount: Number(fix.amount), method: fix.method })) { setFix(null); reload(); }
                        }}>حفظ</Button>
                        <Button variant="ghost" onClick={() => setFix(null)}>إلغاء</Button>
                      </div>
                    )}
                    {p.status === "PENDING" && (
                      <div className="flex gap-2">
                        <Button variant="secondary" busy={m.busy} onClick={() => reviewPayment(p.id, "accept")}>وصل المبلغ</Button>
                        <Button variant="danger" busy={m.busy} onClick={() => reviewPayment(p.id, "reject")}>لم يصل</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(active || (owner && ps && (Number(ps.bookingPaid) > 0 || Number(ps.depositPaid) > Number(ps.depositRefunded)))) && (
            <details className="mt-4 rounded-xl border border-jood-green/10 p-3 text-sm print:hidden">
              <summary className="cursor-pointer text-jood-ink/70">تسجيل دفعة أخرى (باقي المبلغ أو التأمين) أو استرداد</summary>
            {active && (
              <div className="mt-4 rounded-xl bg-jood-beige/60 p-4 print:hidden">
                <p className="mb-3 text-sm font-medium">تسجيل دفعة تحققت من وصولها</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="عن">
                    <select value={pay.purpose} onChange={(e) => setPay({ ...pay, purpose: e.target.value as PaymentPurpose })} className={inputClass}>
                      <option value="BOOKING">مبلغ الحجز</option>
                      {deposit > 0 && <option value="SECURITY_DEPOSIT">التأمين</option>}
                    </select>
                  </Field>
                  <Field label="الطريقة">
                    <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })} className={inputClass}>
                      <option value="BANK_TRANSFER">تحويل بنكي</option>
                      <option value="GATHERN">جاذر إن</option>
                      <option value="CASH">نقدًا</option>
                    </select>
                  </Field>
                  <Field label="المبلغ (ريال)">
                    <input type="number" min={0} step="0.01" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={pay.purpose === "BOOKING" ? (ps?.bookingRemaining ?? String(Math.max(total - paid, 0))) : (ps?.depositRemaining ?? String(deposit))} className={inputClass} />
                  </Field>
                  <Field label="مرجع (اختياري)" hint="رقم العملية أو رقم الحجز في جاذر إن">
                    <input value={pay.externalRef} onChange={(e) => setPay({ ...pay, externalRef: e.target.value })} className={inputClass} dir="ltr" />
                  </Field>
                  <Field label="ملاحظة (اختياري)">
                    <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} className={inputClass} />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-jood-ink/60">سجّل الدفعة فقط بعد التأكد من وصول المبلغ إلى الحساب. صورة الإيصال وحدها لا تكفي. لا تُضاف أي رسوم لجاذر إن تلقائيًا.</p>
                <Button className="mt-3" busy={m.busy} onClick={recordPayment}>تسجيل الدفعة</Button>
              </div>
            )}
            {owner && ps && (Number(ps.bookingPaid) > 0 || Number(ps.depositPaid) > Number(ps.depositRefunded)) && (
              <div className="mt-3 print:hidden">
                {!refund ? (
                  <Button variant="ghost" onClick={() => setRefund({ purpose: Number(ps.depositPaid) > Number(ps.depositRefunded) ? "SECURITY_DEPOSIT" : "BOOKING", method: "BANK_TRANSFER", amount: "", note: "" })}>
                    تسجيل استرداد للضيف
                  </Button>
                ) : (
                  <div className="rounded-xl border border-jood-green/15 p-4">
                    <p className="mb-3 text-sm font-medium">تسجيل مبلغ أُعيد للضيف (يُضاف للسجل ولا تُحذف أي دفعة)</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="عن">
                        <select value={refund.purpose} onChange={(e) => setRefund({ ...refund, purpose: e.target.value as PaymentPurpose })} className={inputClass}>
                          <option value="SECURITY_DEPOSIT">التأمين</option>
                          <option value="BOOKING">مبلغ الحجز</option>
                        </select>
                      </Field>
                      <Field label="الطريقة">
                        <select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value as PaymentMethod })} className={inputClass}>
                          <option value="BANK_TRANSFER">تحويل بنكي</option>
                          <option value="CASH">نقدًا</option>
                          <option value="GATHERN">جاذر إن</option>
                        </select>
                      </Field>
                      <Field label="المبلغ المُعاد (ريال)">
                        <input type="number" min={0} step="0.01" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} className={inputClass} />
                      </Field>
                      <Field label="ملاحظة (مثل: خصم أضرار)">
                        <input value={refund.note} onChange={(e) => setRefund({ ...refund, note: e.target.value })} className={inputClass} />
                      </Field>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button busy={m.busy} onClick={recordRefund}>تسجيل الاسترداد</Button>
                      <Button variant="ghost" onClick={() => setRefund(null)}>إلغاء</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </details>
            )}
          </Card>

          <Card title="سجل الحجز">
            <ol className="space-y-2 text-sm">
              {b.history.length === 0 && <li className="text-jood-ink/60">لا توجد عمليات مسجلة.</li>}
              {b.history.map((h) => {
                const d = h.details as { from?: BookingStatus; to?: BookingStatus; reason?: string } | null;
                return (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="text-jood-ink/55">{dateTime(h.createdAt)}</span>
                    <span>
                      {HISTORY_LABEL[h.action] ?? h.action}
                      {h.action === "booking.status" && d?.from && d?.to && `: ${STATUS[d.from].label} ← ${STATUS[d.to].label}`}
                      {d?.reason && ` (${d.reason})`}
                    </span>
                    {h.user && <span className="text-jood-ink/55">— {h.user.name}</span>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-5 print:hidden">
          <ContractFlowCard b={b} busy={m.busy} patch={patch} onChange={reload} />

          <DoorCodeCard booking={b} onChange={reload} />

          {b.allowedTransitions.length > 0 && (
            <Card title="الإجراءات">
              <div className="flex flex-col gap-2">
                {b.status !== "COMPLETED" && b.allowedTransitions.includes("CONFIRMED") && (
                  <p className="text-xs text-jood-ink/60">لتأكيد الحجز: سجّل العربون في بطاقة «العقد والتواصل».</p>
                )}
                {/* «مكتمل» is set automatically after check-out; a booking marked so by mistake can come back. */}
                {b.status === "COMPLETED" && owner && b.allowedTransitions.includes("CONFIRMED") && (
                  <>
                    <p className="text-xs text-jood-ink/60">يُعتبر الحجز مكتملًا تلقائيًا بعد يوم الخروج. إذا وُضع «مكتمل» بالخطأ قبل انتهاء الإقامة، أرجعه:</p>
                    <Button variant="secondary" busy={m.busy} onClick={() => setStatus("CONFIRMED")}>إرجاع إلى مؤكد</Button>
                  </>
                )}
                {(b.allowedTransitions.includes("CANCELLED") || b.allowedTransitions.includes("REJECTED")) && (
                  <div className="mt-2 border-t border-jood-green/10 pt-3">
                    <Field label="السبب (اختياري)">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
                    </Field>
                    <div className="mt-2 flex gap-2">
                      {b.allowedTransitions.includes("REJECTED") && <Button variant="danger" busy={m.busy} onClick={() => setStatus("REJECTED")}>رفض الطلب</Button>}
                      {b.allowedTransitions.includes("CANCELLED") && <Button variant="danger" busy={m.busy} onClick={() => setStatus("CANCELLED")}>إلغاء الحجز</Button>}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="ملاحظات داخلية">
            <textarea rows={4} value={notes ?? b.adminNotes ?? ""} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="لا تظهر للضيف" />
            <Button className="mt-2" variant="secondary" busy={m.busy} disabled={notes === null} onClick={async () => { await patch({ adminNotes: notes || null }); setNotes(null); }}>
              حفظ
            </Button>
          </Card>
          {owner && <DeleteBookingCard b={b} />}
        </div>
      </div>
    </>
  );
}

/** «استلمت المبلغ — أكّد الحجز»: records exactly the amount still needed and confirms, in one tap. */

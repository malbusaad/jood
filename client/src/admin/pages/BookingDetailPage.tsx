import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, CheckCircle2, Circle, FileText, MessageCircle, Printer } from "lucide-react";
import type { BookingDetail, BookingStatus, PaymentMethod } from "../types";
import { ACTION_LABEL, CHANNEL, METHOD, PAYMENT_STATUS, STATUS } from "../labels";
import { formatDateAr } from "../../lib/format";
import { waLink, waMessages } from "../whatsapp";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, StatusBadge, dateTime, inputClass, money, nightsBetween, useApi, useMutation } from "../ui";

const HISTORY_LABEL: Record<string, string> = {
  "booking.create": "أُنشئ الحجز",
  "booking.status": "تغيير الحالة",
  "booking.update": "تعديل",
};

export default function BookingDetailPage() {
  const { id } = useParams();
  const { data: b, error, loading, reload } = useApi<BookingDetail>(`/api/admin/bookings/${id}`);
  const m = useMutation();
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState<{ method: PaymentMethod; amount: string; externalRef: string; note: string }>({ method: "BANK_TRANSFER", amount: "", externalRef: "", note: "" });
  const [notes, setNotes] = useState<string | null>(null);

  if (loading && !b) return <Loading />;
  if (!b) return <ErrorNote>{error ?? "الحجز غير موجود"}</ErrorNote>;

  const days = nightsBetween(b.startDate, b.endDate);
  const total = Number(b.totalAmount);
  const deposit = Number(b.depositAmount);
  const paid = Number(b.paid);
  const resources = [...new Map(b.items.map((i) => [i.resource.id, i.resource])).values()];
  const messages = waMessages(b);
  const suggested = b.status === "CONFIRMED" ? "confirmed" : b.contractAcceptedAt ? "payment" : "contract";
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
      amount,
      externalRef: pay.externalRef || null,
      note: pay.note || null,
    });
    if (r) {
      setPay({ method: "BANK_TRANSFER", amount: "", externalRef: "", note: "" });
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
              <div><dt className="text-jood-ink/55">الجوال / واتساب</dt><dd dir="ltr" className="text-end sm:text-start"><a href={`tel:+${b.guest.phone}`}>+{b.guest.phone}</a></dd></div>
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
              <div className="flex justify-between"><dt>مبلغ الحجز</dt><dd>{money(total)}</dd></div>
              <div className="flex justify-between text-jood-ink/65"><dt>التأمين (مسترد)</dt><dd>{money(deposit)}</dd></div>
              <div className="flex justify-between font-semibold text-jood-green"><dt>الإجمالي المستحق</dt><dd>{money(total + deposit)}</dd></div>
              <div className="flex justify-between"><dt>المدفوع (متحقق منه)</dt><dd className={paid >= total ? "text-emerald-700" : "text-amber-800"}>{money(paid)}</dd></div>
            </dl>
          </Card>

          <Card title="المدفوعات">
            {b.payments.length === 0 ? (
              <p className="text-sm text-jood-ink/60">لا توجد مدفوعات مسجلة.</p>
            ) : (
              <ul className="divide-y divide-jood-green/10 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium">{money(p.amount)}</span> · {METHOD[p.method]}
                      {p.externalRef && <span dir="ltr"> · {p.externalRef}</span>}
                      <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${p.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-900" : p.status === "REJECTED" ? "bg-stone-200" : "bg-orange-100 text-orange-900"}`}>{PAYMENT_STATUS[p.status]}</span>
                      <div className="text-xs text-jood-ink/55">
                        {p.verifiedAt ? `${p.status === "ACCEPTED" ? "تحقق" : "رُفض"} ${dateTime(p.verifiedAt)}${p.verifiedBy ? ` — ${p.verifiedBy.name}` : ""}` : `أُبلغ ${dateTime(p.createdAt)}`}
                        {p.note && ` · ${p.note}`}
                      </div>
                    </div>
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
            {active && (
              <div className="mt-4 rounded-xl bg-jood-beige/60 p-4 print:hidden">
                <p className="mb-3 text-sm font-medium">تسجيل دفعة تحققت من وصولها</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الطريقة">
                    <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })} className={inputClass}>
                      <option value="BANK_TRANSFER">تحويل بنكي</option>
                      <option value="GATHERN">جاذر إن</option>
                    </select>
                  </Field>
                  <Field label="المبلغ (ريال)">
                    <input type="number" min={0} step="0.01" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={String(Math.max(total - paid, 0))} className={inputClass} />
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
          <Card title="واتساب">
            <div className="space-y-2">
              {messages.map((msg) => (
                <a
                  key={msg.key}
                  href={waLink(b.guest.phone, msg.text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition ${msg.key === suggested ? "bg-[#1f7a4d] text-white hover:bg-[#19663f]" : "border border-jood-green/20 text-jood-green hover:bg-jood-green/5"}`}
                >
                  <MessageCircle aria-hidden className="size-4" /> {msg.label}
                </a>
              ))}
              <a href={waLink(b.guest.phone)} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-jood-green underline">
                فتح المحادثة بدون رسالة
              </a>
            </div>
          </Card>

          <Card title="العقد">
            <Link to={`/admin/bookings/${b.id}/contract`} className="flex items-center justify-center gap-2 rounded-xl bg-jood-green px-4 py-2.5 text-sm text-jood-beige hover:bg-jood-green-800">
              <FileText aria-hidden className="size-4" /> عرض العقد وتنزيله PDF
            </Link>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <button type="button" className="flex w-full items-center gap-2 text-start" onClick={() => patch({ contractSent: !b.contractSentAt })} disabled={m.busy}>
                  {b.contractSentAt ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5 text-jood-ink/30" />}
                  <span>أُرسل العقد للضيف{b.contractSentAt && <span className="block text-xs text-jood-ink/55">{dateTime(b.contractSentAt)}</span>}</span>
                </button>
              </li>
              <li>
                <button type="button" className="flex w-full items-center gap-2 text-start" onClick={() => patch({ contractAccepted: !b.contractAcceptedAt })} disabled={m.busy}>
                  {b.contractAcceptedAt ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5 text-jood-ink/30" />}
                  <span>ردّ الضيف بـ «موافق»{b.contractAcceptedAt && <span className="block text-xs text-jood-ink/55">{dateTime(b.contractAcceptedAt)}</span>}</span>
                </button>
              </li>
            </ul>
          </Card>

          {b.allowedTransitions.length > 0 && (
            <Card title="الإجراءات">
              <div className="flex flex-col gap-2">
                {b.allowedTransitions
                  .filter((s) => s !== "CANCELLED" && s !== "REJECTED")
                  .map((s) => (
                    <Button key={s} variant={s === "CONFIRMED" ? "primary" : "secondary"} busy={m.busy} onClick={() => setStatus(s)} disabled={s === "CONFIRMED" && paid < total}>
                      {ACTION_LABEL[s]}
                    </Button>
                  ))}
                {b.allowedTransitions.includes("CONFIRMED") && paid < total && (
                  <p className="text-xs text-jood-ink/60">للتأكيد: سجّل دفعة متحقق منها تغطي مبلغ الحجز ({money(total)}).</p>
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
        </div>
      </div>
    </>
  );
}

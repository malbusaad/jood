import { useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, Circle, FileText, MessageCircle } from "lucide-react";
import type { BookingDetail, PaymentMethod } from "../types";
import { Button, Card, ErrorNote, dateTime, inputClass, money, useMutation } from "../ui";
import { waLink, waMessages } from "../whatsapp";

type Step = { key: "contract" | "deposit" | "confirmed"; title: string; done: boolean; at?: string | null; hint?: string };

/**
 * «العقد والتواصل»: the whole flow in three short steps —
 * 1) send the contract with the deposit request, 2) record the deposit received (this confirms the
 * booking), 3) send the confirmation message. No separate «موافق» step from the guest.
 */
export default function ContractFlowCard({ b, busy, patch, onChange }: { b: BookingDetail; busy: boolean; patch: (body: Record<string, unknown>) => Promise<void>; onChange: () => void }) {
  const msg = Object.fromEntries(waMessages(b).map((m) => [m.key, m.text]));
  const phone = b.guest.phone;
  const confirmed = b.status === "CONFIRMED" || b.status === "COMPLETED";
  const closed = ["CANCELLED", "REJECTED", "EXPIRED"].includes(b.status);
  const canConfirm = b.allowedTransitions.includes("CONFIRMED");

  const steps: Step[] = [
    { key: "contract", title: "إرسال العقد وطلب العربون", done: Boolean(b.contractSentAt), at: b.contractSentAt, hint: "نزّل العقد PDF وأرفقه في المحادثة" },
    { key: "deposit", title: "تسجيل العربون وتأكيد الحجز", done: confirmed, at: b.confirmedAt },
    { key: "confirmed", title: "رسالة تأكيد الحجز", done: false },
  ];
  // Once confirmed (even without sending the contract, e.g. Gathern), the next step is the confirmation message.
  const current = closed ? null : confirmed ? "confirmed" : (steps.find((s) => !s.done)?.key ?? null);

  const wa = (key: string, label: string, after?: () => void) =>
    phone ? (
      <a href={waLink(phone, msg[key])} target="_blank" rel="noopener noreferrer" onClick={after}
        className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2.5 text-sm text-white hover:bg-[#19663f]">
        <MessageCircle aria-hidden className="size-4" /> {label}
      </a>
    ) : (
      <p className="mt-2 text-xs text-amber-800">رقم جوال الضيف غير مسجل.</p>
    );

  function action(key: Step["key"]) {
    if (key === "contract") return !b.contractSentAt && !confirmed ? wa("contract", "أرسل العقد وطلب العربون عبر واتساب", () => void patch({ contractSent: true })) : null;
    // The deposit can be recorded at any time — e.g. a Gathern booking without a contract.
    if (key === "deposit") return canConfirm ? <DepositForm b={b} onDone={onChange} /> : null;
    return confirmed ? wa("confirmed", "أرسل تأكيد الحجز") : null;
  }

  return (
    <Card title="العقد والتواصل">
      <ol className="space-y-3" aria-label="خطوات العقد والتواصل">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          const act = closed ? null : action(s.key);
          return (
            <li key={s.key} className={`rounded-xl p-2.5 ${isCurrent ? "bg-jood-beige/70" : ""}`} aria-current={isCurrent ? "step" : undefined}>
              <div className="flex items-start gap-2 text-sm">
                {s.done ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <Circle aria-hidden className={`mt-0.5 size-5 shrink-0 ${isCurrent ? "text-jood-gold" : "text-jood-ink/25"}`} />}
                <div className="min-w-0 flex-1">
                  <p className={s.done || isCurrent ? "font-medium" : "text-jood-ink/50"}>
                    {i + 1}. {s.title}
                    {s.done && s.at && <span className="ms-2 text-xs font-normal text-jood-ink/55">{dateTime(s.at)}</span>}
                  </p>
                  {isCurrent && s.hint && <p className="text-xs text-jood-ink/60">{s.hint}</p>}
                </div>
                {s.key === "contract" && s.done && !closed && !confirmed && (
                  <button type="button" disabled={busy} onClick={() => confirm("التراجع عن هذه الخطوة؟") && void patch({ contractSent: false })} className="text-xs text-jood-ink/50 underline">تراجع</button>
                )}
              </div>
              {act}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-jood-green/10 pt-3 text-xs">
        <Link to={`/admin/bookings/${b.id}/contract`} className="inline-flex items-center gap-1 text-jood-green underline">
          <FileText aria-hidden className="size-4" /> عرض العقد وتنزيله PDF
        </Link>
        {phone && <a href={waLink(phone)} target="_blank" rel="noopener noreferrer" className="text-jood-green underline">فتح المحادثة</a>}
      </div>
    </Card>
  );
}

/** One amount + how it arrived → recorded and the booking confirmed. */
function DepositForm({ b, onDone }: { b: BookingDetail; onDone: () => void }) {
  const m = useMutation();
  const remaining = Number(b.payment?.bookingRemaining ?? Number(b.totalAmount) - Number(b.paid));
  const paidAlready = Number(b.paid) > 0;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(b.channel === "GATHERN" ? "GATHERN" : "BANK_TRANSFER");
  const value = amount.trim() === "" ? 0 : Number(amount);
  const tooMuch = value > remaining;
  const half = Math.round(remaining / 2);

  async function save(confirmOnly = false) {
    const ok = await m.run(`/api/admin/bookings/${b.id}/deposit-confirm`, "POST", confirmOnly ? {} : { amount: value, method });
    if (ok) onDone();
  }

  return (
    <div className="mt-2 space-y-2" role="group" aria-label="تسجيل العربون">
      <div className="flex flex-wrap gap-2">
        <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="مبلغ العربون المستلم" aria-label="مبلغ العربون المستلم" className={`${inputClass} min-w-0 flex-1`} />
        <select aria-label="طريقة الاستلام" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={`${inputClass} w-auto`}>
          <option value="BANK_TRANSFER">تحويل</option>
          <option value="CASH">نقدًا</option>
          <option value="GATHERN">جاذر إن</option>
        </select>
      </div>
      {remaining > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button type="button" onClick={() => setAmount(String(half))} className="rounded-full bg-white px-2.5 py-1 ring-1 ring-jood-green/20 hover:bg-jood-beige">النصف {money(half)}</button>
          <button type="button" onClick={() => setAmount(String(remaining))} className="rounded-full bg-white px-2.5 py-1 ring-1 ring-jood-green/20 hover:bg-jood-beige">كامل المبلغ {money(remaining)}</button>
        </div>
      )}
      {tooMuch && <p className="text-xs text-red-800" role="alert">أكبر من المتبقي من مبلغ الحجز ({money(remaining)})</p>}
      {value > 0 && !tooMuch && <p className="text-xs text-jood-ink/65">المتبقي بعده {money(remaining - value)} يُدفع قبل الدخول.</p>}
      <Button className="w-full" busy={m.busy} disabled={!(value > 0) || tooMuch} onClick={() => save()}>تسجيل العربون وتأكيد الحجز</Button>
      {/* Money already recorded (e.g. a payment the guest reported and you accepted): confirm without a new one. */}
      {paidAlready && <Button className="w-full" variant="ghost" busy={m.busy} onClick={() => save(true)}>تأكيد الحجز بالمبلغ المسجل ({money(b.paid)})</Button>}
      <ErrorNote>{m.error}</ErrorNote>
    </div>
  );
}

import { Link } from "react-router";
import { CheckCircle2, Circle, FileText, MessageCircle } from "lucide-react";
import type { BookingDetail } from "../types";
import { Card, dateTime } from "../ui";
import { waLink, waMessages } from "../whatsapp";

type Step = { key: string; title: string; done: boolean; at?: string | null; hint?: string };

/**
 * «العقد والتواصل»: the contract and the guest's WhatsApp messages as one short, ordered flow.
 * Only the next step has a button, so the owner cannot send a message out of order
 * (e.g. a confirmation before the booking is confirmed).
 */
export default function ContractFlowCard({ b, busy, patch }: { b: BookingDetail; busy: boolean; patch: (body: Record<string, unknown>) => Promise<void> }) {
  const msg = Object.fromEntries(waMessages(b).map((m) => [m.key, m.text]));
  const phone = b.guest.phone;
  const confirmed = b.status === "CONFIRMED" || b.status === "COMPLETED";
  const paidEnough = confirmed || Boolean(b.payment?.canConfirm);
  const closed = ["CANCELLED", "REJECTED", "EXPIRED"].includes(b.status);

  const steps: Step[] = [
    { key: "contract", title: "إرسال العقد", done: Boolean(b.contractSentAt), at: b.contractSentAt, hint: "نزّل العقد PDF وأرفقه في المحادثة" },
    { key: "accept", title: "موافقة الضيف بـ «موافق»", done: Boolean(b.contractAcceptedAt), at: b.contractAcceptedAt },
    { key: "payment", title: "طلب التحويل", done: paidEnough, hint: paidEnough ? undefined : "سجّل المبلغ عند وصوله ثم أكّد الحجز" },
    { key: "confirmed", title: "رسالة تأكيد الحجز", done: false },
  ];
  // The first step not done yet is the only one with an action.
  const current = closed ? null : (steps.find((s) => !s.done)?.key ?? null);

  const wa = (key: string, label: string, after?: () => void) =>
    phone ? (
      <a
        href={waLink(phone, msg[key])}
        target="_blank"
        rel="noopener noreferrer"
        onClick={after}
        className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2.5 text-sm text-white hover:bg-[#19663f]"
      >
        <MessageCircle aria-hidden className="size-4" /> {label}
      </a>
    ) : (
      <p className="mt-2 text-xs text-amber-800">رقم جوال الضيف غير مسجل.</p>
    );

  function action(key: string) {
    switch (key) {
      case "contract":
        // Opening the message marks the contract as sent.
        return wa("contract", "أرسل العقد عبر واتساب", () => void patch({ contractSent: true }));
      case "accept":
        return (
          <button type="button" disabled={busy} onClick={() => void patch({ contractAccepted: true })} className="mt-2 w-full rounded-xl border border-jood-green/30 px-4 py-2.5 text-sm text-jood-green hover:bg-jood-green/5">
            الضيف ردّ بـ «موافق»
          </button>
        );
      case "payment":
        return wa("payment", "أرسل طلب التحويل");
      case "confirmed":
        return confirmed ? wa("confirmed", "أرسل تأكيد الحجز") : null;
    }
    return null;
  }

  function undo(key: string) {
    const body = key === "contract" ? { contractSent: false, contractAccepted: false } : { contractAccepted: false };
    if (confirm("التراجع عن هذه الخطوة؟")) void patch(body);
  }

  return (
    <Card title="العقد والتواصل">
      <ol className="space-y-3" aria-label="خطوات العقد والتواصل">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          // The confirmation message stays available once the booking is confirmed.
          const showAction = isCurrent || (s.key === "confirmed" && confirmed && !closed);
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
                {s.done && (s.key === "contract" || s.key === "accept") && !closed && (
                  <button type="button" disabled={busy} onClick={() => undo(s.key)} className="text-xs text-jood-ink/50 underline">تراجع</button>
                )}
              </div>
              {showAction && action(s.key)}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-jood-green/10 pt-3 text-xs">
        <Link to={`/admin/bookings/${b.id}/contract`} className="inline-flex items-center gap-1 text-jood-green underline">
          <FileText aria-hidden className="size-4" /> عرض العقد وتنزيله PDF
        </Link>
        {phone && (
          <a href={waLink(phone)} target="_blank" rel="noopener noreferrer" className="text-jood-green underline">فتح المحادثة</a>
        )}
      </div>
    </Card>
  );
}

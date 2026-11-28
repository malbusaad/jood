import { useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, Circle, FileText, MessageCircle } from "lucide-react";
import type { BookingDetail, PaymentMethod } from "../types";
import CopyButton from "../../components/CopyButton";
import { Button, Card, ErrorNote, dateTime, inputClass, money, useMutation } from "../ui";
import { waLink, waMessages, waPortalMessage } from "../whatsapp";

type Key = "deposit" | "confirm" | "contract" | "balance" | "portal";
type Step = { key: Key; title: string; done: boolean; at?: string | null; hint?: string };

/**
 * «العقد والتواصل» — the owner's whole flow with the guest, in order:
 * 1) ask for the deposit, 2) record it (confirms the booking), 3) send the contract PDF,
 * 4) ask for the rest and the security deposit (only if still unpaid), 5) send the portal link.
 */
export default function ContractFlowCard({ b, busy, patch, onChange }: { b: BookingDetail; busy: boolean; patch: (body: Record<string, unknown>) => Promise<void>; onChange: () => void }) {
  const msg = Object.fromEntries(waMessages(b).map((m) => [m.key, m.text]));
  const phone = b.guest.phone;
  const confirmed = b.status === "CONFIRMED" || b.status === "COMPLETED";
  const closed = ["CANCELLED", "REJECTED", "EXPIRED"].includes(b.status);
  const canConfirm = b.status !== "COMPLETED" && b.allowedTransitions.includes("CONFIRMED");
  const ps = b.payment;
  const settled = Boolean(ps?.fullySettled);
  const now = Date.now();
  const activeLink = b.accessTokens.find((t) => !t.revokedAt && new Date(t.expiresAt).getTime() > now);

  const steps: Step[] = [
    { key: "deposit", title: "المطالبة بدفع العربون", done: confirmed || Number(b.paid) > 0 },
    { key: "confirm", title: "تسجيل العربون وتأكيد الحجز", done: confirmed, at: b.confirmedAt },
    { key: "contract", title: "إرسال العقد PDF", done: Boolean(b.contractSentAt), at: b.contractSentAt, hint: "نزّل العقد PDF وأرفقه في المحادثة" },
    { key: "balance", title: "المطالبة بالمتبقي والتأمين", done: settled, hint: settled ? undefined : "إن لم يُسدَّد بعد" },
    { key: "portal", title: "إرسال رابط البوابة", done: Boolean(activeLink), at: activeLink?.createdAt },
  ];
  const current = closed ? null : (steps.find((s) => !s.done)?.key ?? null);
  /** Steps the owner opened out of order (only the current step shows its buttons by default). */
  const [opened, setOpened] = useState<Key[]>([]);
  /** A portal link just created: kept here so its «send» button survives the refresh that follows. */
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);

  const wa = (key: string, label: string, after?: () => void) =>
    phone ? (
      <a href={waLink(phone, msg[key])} target="_blank" rel="noopener noreferrer" onClick={after}
        className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2.5 text-sm text-white hover:bg-[#19663f]">
        <MessageCircle aria-hidden className="size-4" /> {label}
      </a>
    ) : (
      <p className="mt-2 text-xs text-amber-800">رقم جوال الضيف غير مسجل.</p>
    );

  function action(key: Key) {
    switch (key) {
      case "deposit":
        return !confirmed && Number(b.paid) === 0 ? wa("deposit", "أرسل طلب العربون عبر واتساب") : null;
      case "confirm":
        return canConfirm ? <DepositForm b={b} onDone={onChange} /> : null;
      case "contract":
        return confirmed && !b.contractSentAt ? (
          <>
            <Link to={`/admin/bookings/${b.id}/contract`} className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-jood-green/25 px-4 py-2 text-sm text-jood-green hover:bg-jood-green/5">
              <FileText aria-hidden className="size-4" /> تنزيل العقد PDF
            </Link>
            {wa("contract", "أرسل العقد عبر واتساب", () => void patch({ contractSent: true }))}
          </>
        ) : null;
      case "balance":
        return confirmed && !settled ? (
          <>
            {wa("balance", "أرسل المطالبة بالمتبقي")}
            <BalanceForm b={b} onDone={onChange} />
          </>
        ) : null;
      case "portal":
        return confirmed ? <PortalLink b={b} active={Boolean(activeLink)} issued={issued} onIssued={setIssued} onChange={onChange} /> : null;
    }
  }

  return (
    <Card title="العقد والتواصل">
      <ol className="space-y-3" aria-label="خطوات العقد والتواصل">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          // The deposit form stays visible until confirmation, so the deposit can be recorded whenever it arrives.
          const show = isCurrent || opened.includes(s.key) || (s.key === "confirm" && canConfirm) || (s.key === "portal" && issued !== null);
          const act = closed || !show ? null : action(s.key);
          const canOpen = !closed && !show && action(s.key) !== null;
          return (
            <li key={s.key} className={`rounded-xl p-2.5 ${isCurrent ? "bg-jood-beige/70" : ""}`} aria-current={isCurrent ? "step" : undefined}>
              <div className="flex items-start gap-2 text-sm">
                {s.done ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <Circle aria-hidden className={`mt-0.5 size-5 shrink-0 ${isCurrent ? "text-jood-gold" : "text-jood-ink/25"}`} />}
                <div className="min-w-0 flex-1">
                  <p className={s.done || isCurrent ? "font-medium" : "text-jood-ink/50"}>
                    {canOpen ? (
                      <button type="button" onClick={() => setOpened([...opened, s.key])} className="text-start underline decoration-dotted underline-offset-4" aria-expanded={false}>
                        {i + 1}. {s.title}
                      </button>
                    ) : (
                      <>{i + 1}. {s.title}</>
                    )}
                    {s.done && s.at && <span className="ms-2 text-xs font-normal text-jood-ink/55">{dateTime(s.at)}</span>}
                  </p>
                  {isCurrent && s.hint && <p className="text-xs text-jood-ink/60">{s.hint}</p>}
                </div>
                {s.key === "contract" && s.done && !closed && (
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

const METHODS = (
  <>
    <option value="BANK_TRANSFER">تحويل</option>
    <option value="CASH">نقدًا</option>
    <option value="GATHERN">جاذر إن</option>
  </>
);

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
        <select aria-label="طريقة الاستلام" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={`${inputClass} w-auto`}>{METHODS}</select>
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
      {paidAlready && <Button className="w-full" variant="ghost" busy={m.busy} onClick={() => save(true)}>تأكيد الحجز بالمبلغ المسجل ({money(b.paid)})</Button>}
      <ErrorNote>{m.error}</ErrorNote>
    </div>
  );
}

/** «استلمت المتبقي»: records what is left of the booking amount and the security deposit in one tap. */
function BalanceForm({ b, onDone }: { b: BookingDetail; onDone: () => void }) {
  const m = useMutation();
  const bookingLeft = Number(b.payment?.bookingRemaining ?? 0);
  const depositLeft = Number(b.payment?.depositRemaining ?? 0);
  const [method, setMethod] = useState<PaymentMethod>(b.channel === "GATHERN" ? "GATHERN" : "BANK_TRANSFER");
  if (bookingLeft + depositLeft <= 0) return null;

  async function save() {
    if (!confirm(`تأكيد استلام ${money(bookingLeft + depositLeft)}؟`)) return;
    let ok = true;
    if (bookingLeft > 0) ok = (await m.run(`/api/admin/bookings/${b.id}/payments`, "POST", { method, purpose: "BOOKING", amount: bookingLeft, note: "المتبقي" })) !== null;
    if (ok && depositLeft > 0) ok = (await m.run(`/api/admin/bookings/${b.id}/payments`, "POST", { method, purpose: "SECURITY_DEPOSIT", amount: depositLeft, note: "التأمين" })) !== null;
    onDone();
  }

  return (
    <div className="mt-2 space-y-1.5" role="group" aria-label="تسجيل المتبقي">
      <p className="text-xs text-jood-ink/65">
        المتبقي: {[bookingLeft > 0 ? `مبلغ الحجز ${money(bookingLeft)}` : null, depositLeft > 0 ? `التأمين ${money(depositLeft)}` : null].filter(Boolean).join(" + ")}
      </p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="طريقة استلام المتبقي" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={`${inputClass} w-auto`}>{METHODS}</select>
        <Button variant="secondary" className="flex-1" busy={m.busy} onClick={save}>استلمت المتبقي ({money(bookingLeft + depositLeft)})</Button>
      </div>
      <ErrorNote>{m.error}</ErrorNote>
    </div>
  );
}

/** The guest's private portal link: create it, then send it on WhatsApp (welcome, booking number, link). */
function PortalLink({ b, active, issued, onIssued, onChange }: {
  b: BookingDetail;
  active: boolean;
  issued: { url: string; expiresAt: string } | null;
  onIssued: (link: { url: string; expiresAt: string }) => void;
  onChange: () => void;
}) {
  const m = useMutation();

  async function issue() {
    if (active && !confirm("سيتوقف الرابط الحالي ويُصدر رابط جديد. متابعة؟")) return;
    const r = await m.run<{ url: string; expiresAt: string }>(`/api/admin/bookings/${b.id}/guest-link`, "POST");
    if (r) {
      onIssued(r);
      onChange();
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {issued ? (
        <>
          {b.guest.phone && (
            <a href={waLink(b.guest.phone, waPortalMessage(b, issued.url))} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2.5 text-sm text-white hover:bg-[#19663f]">
              <MessageCircle aria-hidden className="size-4" /> أرسل رابط البوابة عبر واتساب
            </a>
          )}
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1 text-xs" dir="ltr">{issued.url}</p>
            <CopyButton value={issued.url} label="نسخ" />
          </div>
          <p className="text-xs text-jood-ink/60">يظهر الرابط هنا مرة واحدة. صالح حتى {dateTime(issued.expiresAt)}.</p>
        </>
      ) : (
        <Button className="w-full" variant={active ? "ghost" : "primary"} busy={m.busy} onClick={issue}>
          {active ? "إصدار رابط جديد" : "إنشاء رابط البوابة"}
        </Button>
      )}
      <ErrorNote>{m.error}</ErrorNote>
    </div>
  );
}

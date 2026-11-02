import { useState } from "react";
import { Link2, MessageCircle } from "lucide-react";
import type { BookingDetail } from "../types";
import CopyButton from "../../components/CopyButton";
import { waLink, waPortalMessage } from "../whatsapp";
import { Button, Card, ErrorNote, dateTime, useMutation } from "../ui";

/** Issue, send, revoke the guest's private portal link (confirmed bookings only). */
export default function GuestLinkCard({ booking, onChange }: { booking: BookingDetail; onChange: () => void }) {
  const m = useMutation();
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const now = Date.now();
  const active = booking.accessTokens.find((t) => !t.revokedAt && new Date(t.expiresAt).getTime() > now);
  const canIssue = booking.status === "CONFIRMED";

  if (!canIssue && !active) return null;

  async function issue() {
    if (active && !confirm("سيتوقف الرابط الحالي ويُصدر رابط جديد. متابعة؟")) return;
    const r = await m.run<{ url: string; expiresAt: string }>(`/api/admin/bookings/${booking.id}/guest-link`, "POST");
    if (r) {
      setIssued(r);
      onChange();
    }
  }

  async function revoke() {
    if (!confirm("إلغاء رابط الضيف؟ لن يعمل بعد الآن.")) return;
    if ((await m.run(`/api/admin/bookings/${booking.id}/guest-link`, "DELETE")) !== null) {
      setIssued(null);
      onChange();
    }
  }

  return (
    <Card title="بوابة الضيف">
      {issued ? (
        <div className="space-y-3">
          <p className="break-all rounded-xl bg-jood-beige px-3 py-2 text-xs" dir="ltr">{issued.url}</p>
          <div className="flex flex-wrap gap-2">
            <a href={waLink(booking.guest.phone, waPortalMessage(booking, issued.url))} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2.5 text-sm text-white hover:bg-[#19663f]">
              <MessageCircle aria-hidden className="size-4" /> إرسال الرابط للضيف
            </a>
            <CopyButton value={issued.url} label="نسخ الرابط" />
          </div>
          <p className="text-xs text-jood-ink/60">يظهر الرابط هنا مرة واحدة فقط. إذا فقدته أصدر رابطًا جديدًا. صالح حتى {dateTime(issued.expiresAt)}.</p>
        </div>
      ) : active ? (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 text-emerald-800"><Link2 aria-hidden className="size-4" /> يوجد رابط فعّال حتى {dateTime(active.expiresAt)}</p>
          <p className="text-xs text-jood-ink/60">{active.lastUsedAt ? `آخر فتح للرابط: ${dateTime(active.lastUsedAt)}` : "لم يفتحه الضيف بعد."}</p>
        </div>
      ) : (
        <p className="text-sm text-jood-ink/70">أرسل للضيف رابطًا خاصًا فيه تفاصيل الحجز والتعليمات، ويظهر فيه رمز الدخول والواي فاي حسب الإعدادات.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canIssue && (
          <Button variant={issued || active ? "secondary" : "primary"} busy={m.busy} onClick={issue}>
            {active || issued ? "إصدار رابط جديد" : "إنشاء رابط البوابة"}
          </Button>
        )}
        {(active || issued) && <Button variant="danger" busy={m.busy} onClick={revoke}>إلغاء الرابط</Button>}
      </div>
      <div className="mt-2"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

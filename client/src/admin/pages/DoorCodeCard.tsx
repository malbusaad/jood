import { KeyRound } from "lucide-react";
import type { BookingDetail } from "../types";
import { useUser } from "../auth";
import { Button, Card, ErrorNote, dateTime, useMutation } from "../ui";

/** The booking's temporary TTLock door code: shown to the owner, re-issuable, deletable. */
export default function DoorCodeCard({ booking, onChange }: { booking: BookingDetail; onChange: () => void }) {
  const user = useUser();
  const m = useMutation();
  if (!booking.lockConfigured && booking.doorCodes.length === 0) return null;

  const active = booking.doorCodes.find((c) => c.status === "ACTIVE");
  const lastFailed = booking.doorCodes[0]?.status === "FAILED" ? booking.doorCodes[0] : null;
  const owner = user.role === "OWNER";
  const canIssue = owner && booking.lockConfigured && booking.status === "CONFIRMED";

  return (
    <Card title="رقم باب الاستراحة">
      {active ? (
        <div className="space-y-2">
          {booking.doorCode && (
            <p dir="ltr" className="rounded-xl bg-jood-green py-3 text-center font-display text-3xl tracking-[0.25em] text-jood-gold">{booking.doorCode}</p>
          )}
          <p className="text-xs text-jood-ink/60">صالح من {dateTime(active.startsAt)} إلى {dateTime(active.endsAt)}. يظهر للضيف في بوابته حسب الإعدادات.</p>
          {active.error && <p className="text-xs text-red-700">{active.error}</p>}
        </div>
      ) : lastFailed ? (
        <p className="text-sm text-red-800">تعذر إنشاء الرقم: {lastFailed.error}</p>
      ) : (
        <p className="flex items-start gap-2 text-sm text-jood-ink/70">
          <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-jood-gold" />
          {booking.status === "CONFIRMED" ? "لا يوجد رقم باب لهذا الحجز." : "يُنشأ رقم باب مؤقت تلقائيًا عند تأكيد الحجز (إذا فُعّل القفل في الإعدادات)."}
        </p>
      )}
      {owner && (canIssue || active) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canIssue && (
            <Button variant={active ? "secondary" : "primary"} busy={m.busy} onClick={async () => { if ((!active || confirm("سيُحذف الرقم الحالي من القفل ويُنشأ رقم جديد. متابعة؟")) && (await m.run(`/api/admin/bookings/${booking.id}/door-code`, "POST"))) onChange(); }}>
              {active ? "إصدار رقم جديد" : lastFailed ? "إعادة المحاولة" : "إنشاء رقم الباب"}
            </Button>
          )}
          {active && (
            <Button variant="danger" busy={m.busy} onClick={async () => { if (confirm("حذف الرقم من القفل؟") && (await m.run(`/api/admin/bookings/${booking.id}/door-code`, "DELETE")) !== null) onChange(); }}>
              حذف الرقم
            </Button>
          )}
        </div>
      )}
      <div className="mt-2"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

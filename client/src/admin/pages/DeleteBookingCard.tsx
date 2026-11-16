import { useState } from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import type { BookingDetail } from "../types";
import { Button, Card, ErrorNote, inputClass, useMutation } from "../ui";

/**
 * «حذف الحجز نهائيًا» — owner only, for a cancelled, rejected or expired booking. The owner types the
 * booking number, so nothing is deleted by a stray tap.
 */
export default function DeleteBookingCard({ b }: { b: BookingDetail }) {
  const navigate = useNavigate();
  const m = useMutation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [withGuest, setWithGuest] = useState(false);
  if (!["CANCELLED", "REJECTED", "EXPIRED"].includes(b.status)) return null;
  const matches = typed.trim().toUpperCase() === b.reference;

  async function remove() {
    const r = await m.run<{ reference: string }>(`/api/admin/bookings/${b.id}`, "DELETE", { reference: typed.trim(), deleteGuest: withGuest });
    if (r) navigate("/admin/bookings", { replace: true });
  }

  return (
    <Card title="حذف الحجز نهائيًا">
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden className="size-4" /> حذف الحجز نهائيًا
        </Button>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-red-50 p-3 text-red-900">
            يُحذف الحجز ودفعاته ورسائله وروابطه، ولا يمكن التراجع. يبقى سطر في سجل العمليات بما حُذف.
          </p>
          <label className="block">
            <span className="text-jood-ink/75">للتأكيد اكتب رقم الحجز <span dir="ltr" className="font-semibold">{b.reference}</span></span>
            <input dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} mt-1 text-end`} aria-label="رقم الحجز للتأكيد" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withGuest} onChange={(e) => setWithGuest(e.target.checked)} />
            احذف بيانات العميل أيضًا (إن لم يكن له حجوزات أخرى)
          </label>
          <ErrorNote>{m.error}</ErrorNote>
          <div className="flex gap-2">
            <Button variant="danger" busy={m.busy} disabled={!matches} onClick={remove}>حذف نهائي</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setTyped(""); }}>إلغاء</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

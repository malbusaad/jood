import { Link } from "react-router";
import type { BookingSummary } from "../types";
import { CHANNEL } from "../labels";
import { StatusBadge, dayLabel, money, nightsBetween } from "../ui";

/** One booking in a list: who, when, what, status and money at a glance. */
export default function BookingRow({ b }: { b: BookingSummary }) {
  const days = nightsBetween(b.startDate, b.endDate);
  const due = Number(b.totalAmount) - Number(b.paid);
  return (
    <li>
      <Link to={`/admin/bookings/${b.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-jood-beige/60 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{b.guest.name}</span>
            <StatusBadge status={b.status} />
            {b.channel !== "WEBSITE" && <span className="rounded-full bg-jood-gold/15 px-2 py-0.5 text-xs text-jood-ink/70">{CHANNEL[b.channel]}</span>}
            {b.pendingPayments > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">دفعة بانتظار التحقق</span>}
          </div>
          <p className="mt-0.5 truncate text-sm text-jood-ink/65">
            <span dir="ltr">{b.reference}</span> · {dayLabel(b.startDate)}
            {days > 1 ? ` (${days} أيام)` : ""} · {b.resources.map((r) => r.name).join("، ")}
          </p>
        </div>
        <div className="text-sm sm:text-end">
          <div>{money(b.totalAmount)}</div>
          {b.status !== "CANCELLED" && b.status !== "REJECTED" && b.status !== "EXPIRED" && (
            <div className={`text-xs ${due > 0 ? "text-amber-800" : "text-emerald-700"}`}>{due > 0 ? `متبقٍ ${money(due)}` : "مدفوع"}</div>
          )}
        </div>
      </Link>
    </li>
  );
}

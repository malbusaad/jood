import { PushCard } from "../PushSetup";
import { Link } from "react-router";
import { AlertTriangle, CalendarCheck, CircleDollarSign, Inbox, Plus, Receipt, XCircle } from "lucide-react";
import type { Dashboard } from "../types";
import { Button, Card, Empty, ErrorNote, Loading, PageTitle, money, useApi } from "../ui";
import BookingRow from "./BookingRow";

function Stat({ to, label, value, Icon, tone = "" }: { to: string; label: string; value: string | number; Icon: typeof Inbox; tone?: string }) {
  return (
    <Link to={to} className={`rounded-2xl border border-jood-green/10 bg-white p-4 shadow-sm transition hover:border-jood-gold/50 ${tone}`}>
      <Icon aria-hidden className="size-5 text-jood-gold" />
      <p className="mt-3 font-display text-2xl font-semibold text-jood-green">{value}</p>
      <p className="text-sm text-jood-ink/65">{label}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: d, error, loading } = useApi<Dashboard>("/api/admin/dashboard");
  return (
    <>
      <PageTitle title="الرئيسية">
        <Link to="/admin/bookings/new">
          <Button>
            <Plus aria-hidden className="size-4" /> حجز يدوي
          </Button>
        </Link>
      </PageTitle>
      <PushCard compact />
      <ErrorNote>{error}</ErrorNote>
      {loading && !d ? (
        <Loading />
      ) : d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat to="/admin/bookings?status=NEW" label="طلبات جديدة" value={d.newRequests} Icon={Inbox} tone={d.newRequests ? "ring-2 ring-jood-gold/50" : ""} />
            <Stat to="/admin/bookings?status=AWAITING_VERIFICATION" label="دفعات تحتاج تحقق" value={d.awaitingVerification + d.pendingPayments} Icon={Receipt} />
            <Stat to="/admin/calendar" label="حجوزات قادمة" value={d.upcoming} Icon={CalendarCheck} />
            <Stat to="/admin/bookings?status=CONFIRMED" label="مؤكدة قادمة" value={d.confirmedUpcoming} Icon={CalendarCheck} />
            <Stat to="/admin/bookings" label="إيرادات هذا الشهر" value={money(d.revenueMonth)} Icon={CircleDollarSign} />
            <Stat to="/admin/bookings?status=CANCELLED" label="ملغاة هذا الشهر" value={d.cancelledMonth} Icon={XCircle} />
          </div>
          <p className="text-xs text-jood-ink/55">الإيرادات = المدفوعات التي تحققت منها. إجمالي المسجل: {money(d.revenueAll)}.</p>

          {d.unavailableAmenities.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              مرافق غير متاحة حاليًا: {d.unavailableAmenities.map((a) => a.name).join("، ")}.{" "}
              <Link to="/admin/amenities" className="underline">إدارة المرافق</Link>
            </p>
          )}

          <Card title="الحجوزات القادمة" actions={<Link to="/admin/bookings" className="text-sm text-jood-green underline">الكل</Link>}>
            {d.next.length === 0 ? (
              <Empty>لا توجد حجوزات قادمة.</Empty>
            ) : (
              <ul className="-mx-5 divide-y divide-jood-green/10">{d.next.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

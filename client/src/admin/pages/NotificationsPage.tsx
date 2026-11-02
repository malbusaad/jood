import { Link } from "react-router";
import type { Notification } from "../types";
import { Button, Card, Empty, ErrorNote, Loading, PageTitle, dateTime, useApi, useMutation } from "../ui";

const WA: Record<Notification["whatsappStatus"], string | null> = {
  NOT_CONFIGURED: null,
  PENDING: "جارٍ الإرسال إلى واتساب",
  SENT: "أُرسل إلى واتساب",
  FAILED: "تعذر الإرسال إلى واتساب",
};

export default function NotificationsPage() {
  const { data, error, loading, reload } = useApi<{ items: Notification[]; unread: number }>("/api/admin/notifications?limit=100");
  const m = useMutation();
  return (
    <>
      <PageTitle title="الإشعارات">
        {data && data.unread > 0 && (
          <Button variant="secondary" busy={m.busy} onClick={async () => { await m.run("/api/admin/notifications/read-all", "POST"); reload(); }}>
            تعليم الكل كمقروء
          </Button>
        )}
      </PageTitle>
      <ErrorNote>{error}</ErrorNote>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>لا توجد إشعارات.</Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data.items.map((n) => (
              <li key={n.id} className={`px-5 py-3 ${n.readAt ? "" : "bg-jood-gold/10"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-jood-ink/70">{n.body}</p>
                    <p className="mt-1 text-xs text-jood-ink/50">
                      {dateTime(n.createdAt)}
                      {WA[n.whatsappStatus] && <span className={n.whatsappStatus === "FAILED" ? "text-red-700" : ""}> · {WA[n.whatsappStatus]}</span>}
                      {n.whatsappError && <span className="text-red-700" title={n.whatsappError}> ({n.whatsappError.slice(0, 60)})</span>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {n.bookingId && (
                      <Link to={`/admin/bookings/${n.bookingId}`} onClick={() => !n.readAt && m.run(`/api/admin/notifications/${n.id}/read`, "POST")}>
                        <Button variant="secondary">فتح الحجز</Button>
                      </Link>
                    )}
                    {!n.readAt && (
                      <Button variant="ghost" onClick={async () => { await m.run(`/api/admin/notifications/${n.id}/read`, "POST"); reload(); }}>
                        مقروء
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

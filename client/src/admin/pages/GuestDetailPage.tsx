import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, MessageCircle } from "lucide-react";
import type { BookingSummary, Guest } from "../types";
import { waLink } from "../whatsapp";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, useApi, useMutation } from "../ui";
import BookingRow from "./BookingRow";

export default function GuestDetailPage() {
  const { id } = useParams();
  const { data: g, error, loading, reload } = useApi<Guest & { bookings: BookingSummary[] }>(`/api/admin/guests/${id}`);
  const m = useMutation();
  const [notes, setNotes] = useState<string | null>(null);
  if (loading && !g) return <Loading />;
  if (!g) return <ErrorNote>{error ?? "الضيف غير موجود"}</ErrorNote>;
  return (
    <>
      <Link to="/admin/guests" className="mb-3 inline-flex items-center gap-1 text-sm text-jood-green"><ArrowRight aria-hidden className="size-4" /> الضيوف</Link>
      <PageTitle title={g.name}>
        <a href={waLink(g.phone)} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary"><MessageCircle aria-hidden className="size-4" /> واتساب</Button>
        </a>
      </PageTitle>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card title={`الحجوزات (${g.bookings.length})`}>
          {g.bookings.length === 0 ? <Empty>لا توجد حجوزات.</Empty> : <ul className="-mx-5 divide-y divide-jood-green/10">{g.bookings.map((b) => <BookingRow key={b.id} b={b} />)}</ul>}
        </Card>
        <Card title="البيانات">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-jood-ink/55">الجوال</dt><dd dir="ltr" className="text-end">+{g.phone}</dd></div>
            {g.email && <div><dt className="text-jood-ink/55">البريد</dt><dd dir="ltr" className="text-end">{g.email}</dd></div>}
          </dl>
          <Field label="ملاحظات" className="mt-4">
            <textarea rows={4} value={notes ?? g.notes ?? ""} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
          <ErrorNote>{m.error}</ErrorNote>
          <Button className="mt-2" variant="secondary" busy={m.busy} disabled={notes === null} onClick={async () => { if (await m.run(`/api/admin/guests/${g.id}`, "PATCH", { notes: notes || null })) { setNotes(null); reload(); } }}>
            حفظ
          </Button>
        </Card>
      </div>
    </>
  );
}

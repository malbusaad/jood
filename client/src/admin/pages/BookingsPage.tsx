import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Plus, Search } from "lucide-react";
import type { BookingStatus, BookingSummary } from "../types";
import { STATUS } from "../labels";
import { Button, Card, Empty, ErrorNote, Loading, PageTitle, inputClass, useApi } from "../ui";
import BookingRow from "./BookingRow";

const filters: { value: string; label: string }[] = [
  { value: "", label: "الكل" },
  ...(["NEW", "AWAITING_PAYMENT", "AWAITING_VERIFICATION", "CONFIRMED", "COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"] as BookingStatus[]).map((s) => ({ value: s, label: STATUS[s].label })),
];

export default function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);

  const query = new URLSearchParams();
  for (const k of ["status", "q", "from", "to", "page"]) {
    const v = params.get(k);
    if (v) query.set(k, v);
  }
  const { data, error, loading } = useApi<{ items: BookingSummary[]; total: number; pageSize: number }>(`/api/admin/bookings?${query}`);

  function update(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    if (!("page" in next)) p.delete("page");
    setParams(p);
  }

  return (
    <>
      <PageTitle title="الحجوزات">
        <Link to="/admin/bookings/new">
          <Button>
            <Plus aria-hidden className="size-4" /> حجز يدوي / جاذر إن
          </Button>
        </Link>
      </PageTitle>

      <Card className="mb-4">
        <form
          className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q });
          }}
        >
          <label className="relative">
            <span className="sr-only">بحث</span>
            <Search aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-jood-ink/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم الحجز أو اسم الضيف أو الجوال" className={`${inputClass} pr-9`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            من <input type="date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            إلى <input type="date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} className={inputClass} />
          </label>
          <Button type="submit" variant="secondary">بحث</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="تصفية بالحالة">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => update({ status: f.value })}
              aria-pressed={status === f.value}
              className={`rounded-full px-3 py-1 text-xs transition ${status === f.value ? "bg-jood-green text-jood-beige" : "bg-jood-beige text-jood-ink/75 hover:bg-jood-gold/20"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      <ErrorNote>{error}</ErrorNote>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>لا توجد حجوزات مطابقة.</Empty>
        ) : (
          <>
            <p className="mb-2 text-xs text-jood-ink/55">{data.total} حجز</p>
            <ul className="-mx-5 divide-y divide-jood-green/10">{data.items.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            {data.total > data.pageSize && (
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>السابق</Button>
                <span className="self-center text-sm">{page} / {Math.ceil(data.total / data.pageSize)}</span>
                <Button variant="secondary" disabled={page * data.pageSize >= data.total} onClick={() => update({ page: String(page + 1) })}>التالي</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

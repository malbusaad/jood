import { useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import type { Guest } from "../types";
import { Card, Empty, ErrorNote, Loading, PageTitle, dayLabel, inputClass, useApi } from "../ui";

export default function GuestsPage() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, loading } = useApi<Guest[]>(`/api/admin/guests${search ? `?q=${encodeURIComponent(search)}` : ""}`);
  return (
    <>
      <PageTitle title="الضيوف" />
      <Card className="mb-4">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q); }} className="relative">
          <Search aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-jood-ink/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو الجوال أو البريد" aria-label="بحث عن ضيف" className={`${inputClass} pr-9`} />
        </form>
      </Card>
      <ErrorNote>{error}</ErrorNote>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data || data.length === 0 ? (
          <Empty>لا يوجد ضيوف.</Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data.map((g) => (
              <li key={g.id}>
                <Link to={`/admin/guests/${g.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-jood-beige/50">
                  <span>
                    <span className="font-medium">{g.name}</span>
                    <span dir="ltr" className="ms-2 text-sm text-jood-ink/60">{g.phone ? `+${g.phone}` : "—"}</span>
                    {g.nationalIdMasked && <span dir="ltr" className="ms-2 text-xs text-jood-ink/50">ID {g.nationalIdMasked}</span>}
                  </span>
                  <span className="text-sm text-jood-ink/60">
                    {g.bookingCount} حجز{g.lastStay ? ` · آخر حجز ${dayLabel(g.lastStay)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { MessageCircle, Phone, Search, Star, UserPlus, Users, X } from "lucide-react";
import type { Guest } from "../types";
import { Card, Empty, ErrorNote, Loading, PageTitle, dayLabel, inputClass, useApi } from "../ui";
import { waLink } from "../whatsapp";

type Sort = "recent" | "bookings" | "name";
type Filter = "all" | "returning" | "new";

const AVATAR = ["bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-sky-100 text-sky-800", "bg-rose-100 text-rose-800", "bg-violet-100 text-violet-800", "bg-teal-100 text-teal-800"];
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
}
function avatarClass(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

/** «الضيوف»: the customers, searchable as you type, with quick call / WhatsApp. */
export default function GuestsPage() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading } = useApi<Guest[]>(`/api/admin/guests${search ? `?q=${encodeURIComponent(search)}` : ""}`);

  const monthStart = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).slice(0, 7);
  const stats = useMemo(() => {
    const all = data ?? [];
    return {
      total: all.length,
      returning: all.filter((g) => g.bookingCount >= 2).length,
      newThisMonth: all.filter((g) => g.createdAt.slice(0, 7) === monthStart).length,
    };
  }, [data, monthStart]);

  const list = useMemo(() => {
    let all = [...(data ?? [])];
    if (filter === "returning") all = all.filter((g) => g.bookingCount >= 2);
    if (filter === "new") all = all.filter((g) => g.createdAt.slice(0, 7) === monthStart);
    if (sort === "bookings") all.sort((a, b) => b.bookingCount - a.bookingCount || (b.lastStay ?? "").localeCompare(a.lastStay ?? ""));
    else if (sort === "name") all.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    else all.sort((a, b) => (b.lastStay ?? b.createdAt).localeCompare(a.lastStay ?? a.createdAt));
    return all;
  }, [data, filter, sort, monthStart]);

  const tiles: [Filter, string, number, typeof Users][] = [
    ["all", "كل العملاء", stats.total, Users],
    ["returning", "عملاء دائمون", stats.returning, Star],
    ["new", "جدد هذا الشهر", stats.newThisMonth, UserPlus],
  ];

  return (
    <>
      <PageTitle title="الضيوف" />
      <div className="mb-4 grid grid-cols-3 gap-3" role="group" aria-label="تصفية العملاء">
        {tiles.map(([k, label, n, Icon]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
            className={`rounded-2xl p-3 text-start shadow-sm ring-1 transition sm:p-4 ${filter === k ? "bg-jood-green text-jood-beige ring-jood-green" : "bg-white ring-jood-green/10 hover:ring-jood-green/30"}`}>
            <span className="flex items-center gap-1.5 text-[11px] sm:text-xs"><Icon aria-hidden className={`size-3.5 ${filter === k ? "text-jood-gold" : "text-jood-gold"}`} />{label}</span>
            <span className="mt-1 block font-display text-2xl font-semibold">{n}</span>
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-jood-ink/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الجوال أو البريد" aria-label="بحث عن ضيف" className={`${inputClass} pr-9 pl-9`} />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="مسح البحث" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full p-1 text-jood-ink/40 hover:bg-jood-beige">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex rounded-xl bg-jood-beige/70 p-1 text-xs" role="radiogroup" aria-label="الترتيب">
            {([["recent", "الأحدث"], ["bookings", "الأكثر حجزًا"], ["name", "الاسم"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)}
                className={`rounded-lg px-3 py-1.5 transition ${sort === k ? "bg-white font-medium text-jood-green shadow-sm" : "text-jood-ink/65"}`}>{l}</button>
            ))}
          </div>
        </div>
      </Card>

      <ErrorNote>{error}</ErrorNote>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>{search ? "لا يوجد عميل بهذا البحث." : "لا يوجد ضيوف."}</Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-jood-green/10" aria-label="قائمة العملاء">
            {list.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-jood-beige/40">
                <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${avatarClass(g.id)}`}>{initials(g.name)}</span>
                <Link to={`/admin/guests/${g.id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{g.name}</span>
                    {g.bookingCount >= 2 && <span className="inline-flex items-center gap-0.5 rounded-full bg-jood-gold/15 px-2 py-0.5 text-[11px] text-jood-ink/80"><Star aria-hidden className="size-3 text-jood-gold" /> عميل دائم</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-jood-ink/60">
                    <span dir="ltr">{g.phone ? `+${g.phone}` : "بلا جوال"}</span>
                    {g.nationalIdMasked && <span dir="ltr">ID {g.nationalIdMasked}</span>}
                    <span>{g.bookingCount} {g.bookingCount === 1 ? "حجز" : "حجوزات"}{g.lastStay ? ` · آخر حجز ${dayLabel(g.lastStay)}` : ""}</span>
                  </span>
                </Link>
                {g.phone && (
                  <span className="flex shrink-0 gap-1">
                    <a href={waLink(g.phone)} target="_blank" rel="noopener noreferrer" aria-label={`واتساب ${g.name}`} className="grid size-9 place-items-center rounded-full bg-[#1f7a4d]/10 text-[#1f7a4d] hover:bg-[#1f7a4d]/20"><MessageCircle className="size-4" /></a>
                    <a href={`tel:+${g.phone}`} aria-label={`اتصال ${g.name}`} className="grid size-9 place-items-center rounded-full bg-jood-green/10 text-jood-green hover:bg-jood-green/20"><Phone className="size-4" /></a>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

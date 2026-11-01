import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, useApi, useMutation } from "../ui";

interface Resource {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: "FULL" | "PART";
  active: boolean;
  sortOrder: number;
  amenities: { amenity: { id: string; name: string; available: boolean } }[];
  pricingRules: { id: string; active: boolean }[];
}
interface Conflict { id: string; resourceAId: string; resourceBId: string; reason: string | null }
interface Amenity { id: string; name: string }

const emptyPart = { slug: "", name: "", description: "", active: true, sortOrder: 10, amenityIds: [] as string[] };

/** Bookable parts (made of amenities) and the explicit conflicts between them. */
export default function ResourcesPage() {
  const { data, error, loading, reload } = useApi<{ resources: Resource[]; conflicts: Conflict[] }>("/api/admin/resources");
  const { data: amenities } = useApi<Amenity[]>("/api/admin/amenities");
  const m = useMutation();
  const [editing, setEditing] = useState<(typeof emptyPart & { id?: string }) | null>(null);
  const [conflict, setConflict] = useState({ a: "", b: "", reason: "" });

  const name = (id: string) => data?.resources.find((r) => r.id === id)?.name ?? "؟";
  const parts = data?.resources.filter((r) => r.kind === "PART") ?? [];
  const full = data?.resources.find((r) => r.kind === "FULL");

  async function save() {
    if (!editing) return;
    const body = { ...(editing.id ? {} : { slug: editing.slug }), name: editing.name, description: editing.description || null, active: editing.active, sortOrder: editing.sortOrder, amenityIds: editing.amenityIds };
    const r = editing.id ? await m.run(`/api/admin/resources/${editing.id}`, "PATCH", body) : await m.run("/api/admin/resources", "POST", body);
    if (r) {
      setEditing(null);
      reload();
    }
  }

  return (
    <>
      <PageTitle title="الأجزاء القابلة للحجز">
        <Button onClick={() => setEditing({ ...emptyPart })}><Plus className="size-4" /> جزء جديد</Button>
      </PageTitle>
      <div className="mb-5 space-y-1 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7">
        <p>كل جزء يتكون من مرفق أو أكثر. المرافق التي لا تنفصل اجمعها في جزء واحد (مثل المجلس مع دورات المياه).</p>
        <p>يتعارض جزءان تلقائيًا إذا اشتركا في مرفق، والاستراحة كاملة تتعارض مع كل الأجزاء. أضف «تعارضًا صريحًا» لجزأين لا يشتركان في مرفق ولا يصح حجزهما معًا.</p>
        <p>لا يمكن حجز جزء قبل أن تحدد سعره من <Link to="/admin/pricing" className="underline">الأسعار</Link>.</p>
      </div>
      <ErrorNote>{error || m.error}</ErrorNote>

      {editing && (
        <Card title={editing.id ? `تعديل ${editing.name}` : "جزء جديد"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="الاسم"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} /></Field>
            {!editing.id && (
              <Field label="المعرّف بالإنجليزية" hint="مثل majlis">
                <input dir="ltr" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} className={inputClass} />
              </Field>
            )}
            <Field label="الوصف (اختياري)" className="md:col-span-2"><input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={inputClass} /></Field>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-jood-ink/80">المرافق التي يشملها</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {amenities?.map((a) => {
                  const on = editing.amenityIds.includes(a.id);
                  return (
                    <label key={a.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${on ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => setEditing({ ...editing, amenityIds: on ? editing.amenityIds.filter((x) => x !== a.id) : [...editing.amenityIds, a.id] })} />
                      {a.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="size-4 accent-jood-green" /> متاح للحجز في الموقع</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!editing.name || editing.amenityIds.length === 0}>حفظ</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {loading && !data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {full && (
            <Card title={full.name}>
              <p className="text-sm text-jood-ink/65">يشمل كل المرافق ({full.amenities.length}) ويتعارض مع كل الأجزاء. {full.pricingRules.length === 0 && <span className="text-amber-800">لا توجد أسعار.</span>}</p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={full.active} onChange={async () => { if (await m.run(`/api/admin/resources/${full.id}`, "PATCH", { active: !full.active })) reload(); }} className="size-4 accent-jood-green" />
                متاح للحجز في الموقع
              </label>
            </Card>
          )}
          <Card title="الأجزاء">
            {parts.length === 0 ? (
              <Empty>لم تُضف أجزاء بعد. حاليًا يُحجز فقط «الاستراحة كاملة».</Empty>
            ) : (
              <ul className="-mx-5 divide-y divide-jood-green/10">
                {parts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <div>
                      <span className="font-medium">{r.name}</span>
                      {!r.active && <span className="ms-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">موقوف</span>}
                      {r.pricingRules.filter((p) => p.active).length === 0 && <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">بلا سعر — غير قابل للحجز</span>}
                      <p className="text-sm text-jood-ink/60">يشمل: {r.amenities.map((a) => a.amenity.name).join("، ")}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" aria-label={`تعديل ${r.name}`} onClick={() => setEditing({ id: r.id, slug: r.slug, name: r.name, description: r.description ?? "", active: r.active, sortOrder: r.sortOrder, amenityIds: r.amenities.map((a) => a.amenity.id) })}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" aria-label={`حذف ${r.name}`} onClick={async () => { if (confirm(`حذف «${r.name}»؟`) && (await m.run(`/api/admin/resources/${r.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="التعارضات الصريحة">
            {data && data.conflicts.length > 0 ? (
              <ul className="mb-4 space-y-2 text-sm">
                {data.conflicts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-jood-beige/60 px-3 py-2">
                    <span>{name(c.resourceAId)} ✕ {name(c.resourceBId)}{c.reason && <span className="text-jood-ink/60"> — {c.reason}</span>}</span>
                    <Button variant="ghost" aria-label="حذف التعارض" onClick={async () => { if (await m.run(`/api/admin/resources/conflicts/${c.id}`, "DELETE")) reload(); }}><Trash2 className="size-4" /></Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-jood-ink/60">لا توجد تعارضات صريحة.</p>
            )}
            {parts.length >= 2 && (
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                <Field label="الجزء الأول"><select value={conflict.a} onChange={(e) => setConflict({ ...conflict, a: e.target.value })} className={inputClass}><option value="">—</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label="الجزء الثاني"><select value={conflict.b} onChange={(e) => setConflict({ ...conflict, b: e.target.value })} className={inputClass}><option value="">—</option>{parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label="السبب (اختياري)"><input value={conflict.reason} onChange={(e) => setConflict({ ...conflict, reason: e.target.value })} className={inputClass} /></Field>
                <Button busy={m.busy} disabled={!conflict.a || !conflict.b} onClick={async () => { if (await m.run("/api/admin/resources/conflicts", "POST", { resourceAId: conflict.a, resourceBId: conflict.b, reason: conflict.reason || null })) { setConflict({ a: "", b: "", reason: "" }); reload(); } }}>إضافة</Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

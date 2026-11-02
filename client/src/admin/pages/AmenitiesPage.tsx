import { useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useUser } from "../auth";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, inputClass, useApi, useMutation } from "../ui";

interface Amenity {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  capacityText: string | null;
  capacityMax: number | null;
  note: string | null;
  icon: string;
  sortOrder: number;
  visible: boolean;
  available: boolean;
}

const ICONS: [string, string][] = [
  ["tent", "خيمة"], ["majlis", "مجلس"], ["dining", "طعام"], ["outdoor", "جلسة خارجية"], ["kitchen", "مطبخ"],
  ["restroom", "دورات مياه"], ["volleyball", "ملعب"], ["coffee", "قهوة"], ["kids", "ألعاب أطفال"], ["wifi", "إنترنت"],
];

const empty = { slug: "", name: "", description: "", capacityText: "", note: "", icon: "outdoor", sortOrder: 100, visible: true, available: true };

export default function AmenitiesPage() {
  const user = useUser();
  const { data, error, loading, reload } = useApi<Amenity[]>("/api/admin/amenities");
  const m = useMutation();
  const [editing, setEditing] = useState<(typeof empty & { id?: string }) | null>(null);

  async function save() {
    if (!editing) return;
    const body = {
      ...(editing.id ? {} : { slug: editing.slug }),
      name: editing.name,
      description: editing.description || null,
      capacityText: editing.capacityText || null,
      note: editing.note || null,
      icon: editing.icon,
      sortOrder: Number(editing.sortOrder),
      visible: editing.visible,
      available: editing.available,
    };
    const r = editing.id ? await m.run(`/api/admin/amenities/${editing.id}`, "PATCH", body) : await m.run("/api/admin/amenities", "POST", body);
    if (r) {
      setEditing(null);
      reload();
    }
  }

  async function toggle(a: Amenity, field: "visible" | "available") {
    if (await m.run(`/api/admin/amenities/${a.id}`, "PATCH", { [field]: !a[field] })) reload();
  }

  async function remove(a: Amenity) {
    if (!confirm(`حذف «${a.name}»؟`)) return;
    if (await m.run(`/api/admin/amenities/${a.id}`, "DELETE")) reload();
  }

  return (
    <>
      <PageTitle title="المرافق">
        <Button onClick={() => setEditing({ ...empty })}><Plus className="size-4" /> مرفق</Button>
      </PageTitle>
      <p className="mb-4 text-sm text-jood-ink/60">
        «متاح» يتحكم في إمكانية حجز الأجزاء التي تشمل المرفق (مثل إيقاف الجلسات الخارجية في غير موسمها). «ظاهر» يتحكم في ظهوره في الموقع.
      </p>
      <ErrorNote>{error || m.error}</ErrorNote>

      {editing && (
        <Card title={editing.id ? `تعديل ${editing.name}` : "مرفق جديد"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="الاسم"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} /></Field>
            {!editing.id && (
              <Field label="المعرّف بالإنجليزية" hint="أحرف صغيرة وأرقام وشرطة، مثل bbq-area">
                <input dir="ltr" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} className={inputClass} />
              </Field>
            )}
            <Field label="السعة" hint="مثل «12 إلى 15 شخصًا»"><input value={editing.capacityText} onChange={(e) => setEditing({ ...editing, capacityText: e.target.value })} className={inputClass} /></Field>
            <Field label="ملاحظة قصيرة" hint="مثل «متكامل» أو «متوفر»"><input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} className={inputClass} /></Field>
            <Field label="الأيقونة">
              <select value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} className={inputClass}>
                {ICONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="ترتيب الظهور"><input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} className={inputClass} /></Field>
            <Field label="الوصف (اختياري)" className="md:col-span-2"><textarea rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={inputClass} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.available} onChange={(e) => setEditing({ ...editing, available: e.target.checked })} className="size-4 accent-jood-green" /> متاح</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.visible} onChange={(e) => setEditing({ ...editing, visible: e.target.checked })} className="size-4 accent-jood-green" /> ظاهر في الموقع</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save}>حفظ</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      <Card>
        {loading && !data ? (
          <Loading />
        ) : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <span className={`font-medium ${a.visible ? "" : "text-jood-ink/40"}`}>{a.name}</span>
                  <span className="ms-2 text-sm text-jood-ink/60">{[a.capacityText, a.note].filter(Boolean).join(" · ")}</span>
                  {!a.available && <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">غير متاح</span>}
                  {!a.visible && <span className="ms-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">مخفي</span>}
                </div>
                <div className="flex items-center gap-1">
                  <label className="me-2 flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={a.available} onChange={() => toggle(a, "available")} className="size-4 accent-jood-green" /> متاح
                  </label>
                  <Button variant="ghost" aria-label={a.visible ? `إخفاء ${a.name}` : `إظهار ${a.name}`} onClick={() => toggle(a, "visible")}>
                    {a.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </Button>
                  <Button variant="ghost" aria-label={`تعديل ${a.name}`} onClick={() => setEditing({ id: a.id, slug: a.slug, name: a.name, description: a.description ?? "", capacityText: a.capacityText ?? "", note: a.note ?? "", icon: a.icon, sortOrder: a.sortOrder, visible: a.visible, available: a.available })}>
                    <Pencil className="size-4" />
                  </Button>
                  {user.role === "OWNER" && (
                    <Button variant="ghost" aria-label={`حذف ${a.name}`} onClick={() => remove(a)}><Trash2 className="size-4" /></Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

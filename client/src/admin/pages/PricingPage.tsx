import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi, useMutation } from "../ui";

type Kind = "WEEKDAY" | "SEASON" | "SPECIAL";
interface Rule { id: string; resourceId: string; kind: Kind; label: string | null; daysOfWeek: number[]; startDate: string | null; endDate: string | null; price: string; priority: number; active: boolean }
interface Resource { id: string; name: string; kind: "FULL" | "PART" }

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const KIND: Record<Kind, string> = { WEEKDAY: "حسب أيام الأسبوع", SEASON: "موسمي", SPECIAL: "سعر خاص لتاريخ" };

const emptyRule = { resourceId: "", kind: "WEEKDAY" as Kind, label: "", daysOfWeek: [] as number[], startDate: "", endDate: "", price: "", priority: 0, active: true };

export default function PricingPage() {
  const { data: rules, error, loading, reload } = useApi<Rule[]>("/api/admin/pricing");
  const { data: res } = useApi<{ resources: Resource[] }>("/api/admin/resources");
  const m = useMutation();
  const [editing, setEditing] = useState<(typeof emptyRule & { id?: string }) | null>(null);

  async function save() {
    if (!editing) return;
    const body = {
      resourceId: editing.resourceId,
      kind: editing.kind,
      label: editing.label || null,
      daysOfWeek: editing.daysOfWeek,
      startDate: editing.kind === "WEEKDAY" ? null : editing.startDate || null,
      endDate: editing.kind === "WEEKDAY" ? null : editing.endDate || null,
      price: Number(editing.price),
      priority: editing.priority,
      active: editing.active,
    };
    const r = editing.id ? await m.run(`/api/admin/pricing/${editing.id}`, "PUT", body) : await m.run("/api/admin/pricing", "POST", body);
    if (r) {
      setEditing(null);
      reload();
    }
  }

  const days = (d: number[]) => (d.length === 0 || d.length === 7 ? "كل الأيام" : d.map((x) => DAYS[x]).join("، "));

  return (
    <>
      <PageTitle title="الأسعار">
        <Button onClick={() => setEditing({ ...emptyRule, resourceId: res?.resources[0]?.id ?? "" })}><Plus className="size-4" /> قاعدة سعر</Button>
      </PageTitle>
      <p className="mb-4 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7">
        الأولوية: «سعر خاص لتاريخ» ثم «موسمي» ثم «حسب أيام الأسبوع». أي يوم بلا سعر لا يمكن حجزه. الأسعار لليوم الواحد بالريال.
      </p>
      <ErrorNote>{error || m.error}</ErrorNote>

      {editing && (
        <Card title={editing.id ? "تعديل قاعدة السعر" : "قاعدة سعر جديدة"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="لـ">
              <select value={editing.resourceId} onChange={(e) => setEditing({ ...editing, resourceId: e.target.value })} className={inputClass}>
                {res?.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="النوع">
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Kind })} className={inputClass}>
                {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
              </select>
            </Field>
            <Field label="السعر لليوم (ريال)"><input type="number" min={0} step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} className={inputClass} /></Field>
            <Field label="الاسم (اختياري)" hint="مثل «موسم الشتاء»"><input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className={inputClass} /></Field>
            {editing.kind !== "WEEKDAY" && (
              <>
                <Field label="من تاريخ"><input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} className={inputClass} /></Field>
                <Field label="إلى تاريخ (شامل)"><input type="date" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} className={inputClass} /></Field>
              </>
            )}
            <fieldset className="md:col-span-3">
              <legend className="text-sm font-medium text-jood-ink/80">الأيام {editing.kind !== "WEEKDAY" && <span className="font-normal text-jood-ink/55">(اتركها كلها فارغة لتشمل كل الأيام)</span>}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DAYS.map((d, i) => {
                  const on = editing.daysOfWeek.includes(i);
                  return (
                    <label key={d} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${on ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => setEditing({ ...editing, daysOfWeek: on ? editing.daysOfWeek.filter((x) => x !== i) : [...editing.daysOfWeek, i] })} />
                      {d}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="size-4 accent-jood-green" /> مفعّلة</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!editing.resourceId || editing.price === ""}>حفظ</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {loading && !rules ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {res?.resources.map((r) => {
            const list = rules?.filter((x) => x.resourceId === r.id) ?? [];
            return (
              <Card key={r.id} title={r.name}>
                {list.length === 0 ? (
                  <Empty>لا توجد أسعار — {r.kind === "PART" ? "هذا الجزء غير قابل للحجز حتى تضيف سعرًا." : "لا يمكن الحجز."}</Empty>
                ) : (
                  <ul className="-mx-5 divide-y divide-jood-green/10">
                    {list.map((x) => (
                      <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 ${x.active ? "" : "opacity-50"}`}>
                        <div>
                          <span className="font-display text-lg font-semibold text-jood-green">{money(x.price)}</span>
                          <span className="ms-2 text-sm">{x.label ?? KIND[x.kind]}</span>
                          <p className="text-xs text-jood-ink/60">
                            {KIND[x.kind]} · {days(x.daysOfWeek)}
                            {x.startDate && ` · من ${x.startDate.slice(0, 10)} إلى ${x.endDate?.slice(0, 10)}`}
                            {!x.active && " · موقوفة"}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" aria-label="تعديل" onClick={() => setEditing({ id: x.id, resourceId: x.resourceId, kind: x.kind, label: x.label ?? "", daysOfWeek: x.daysOfWeek, startDate: x.startDate?.slice(0, 10) ?? "", endDate: x.endDate?.slice(0, 10) ?? "", price: String(Number(x.price)), priority: x.priority, active: x.active })}><Pencil className="size-4" /></Button>
                          <Button variant="ghost" aria-label="حذف" onClick={async () => { if (confirm("حذف قاعدة السعر؟") && (await m.run(`/api/admin/pricing/${x.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

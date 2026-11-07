import { useState } from "react";
import { CalendarPlus, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi, useMutation } from "../ui";

type Kind = "WEEKDAY" | "SEASON" | "SPECIAL";
interface Rule { id: string; resourceId: string; kind: Kind; label: string | null; daysOfWeek: number[]; startDate: string | null; endDate: string | null; price: string; priority: number; active: boolean }
interface Resource { id: string; name: string; kind: "FULL" | "PART" }

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const KIND: Record<Kind, string> = { WEEKDAY: "حسب أيام الأسبوع", SEASON: "موسم / فترة", SPECIAL: "سعر خاص (مناسبة)" };

const emptyRule = { resourceId: "", kind: "WEEKDAY" as Kind, label: "", daysOfWeek: [] as number[], startDate: "", endDate: "", price: "", priority: 0, active: true };

/**
 * Two sections share this page:
 *  - «الأسعار الأساسية»: weekday prices (unchanged behaviour).
 *  - «الأسعار الخاصة والمواسم»: dated prices for holidays, occasions, seasons and offers.
 */
export default function PricingPage({ mode = "base" }: { mode?: "base" | "special" }) {
  const { data: allRules, error, loading, reload } = useApi<Rule[]>("/api/admin/pricing");
  const { data: res } = useApi<{ resources: Resource[] }>("/api/admin/resources");
  const m = useMutation();
  const [editing, setEditing] = useState<(typeof emptyRule & { id?: string }) | null>(null);
  const [group, setGroup] = useState<{ resourceIds: string[]; label: string; dates: string[]; next: string; price: string; priority: number } | null>(null);
  const special = mode === "special";
  const kinds: Kind[] = special ? ["SPECIAL", "SEASON"] : ["WEEKDAY"];
  const rules = allRules?.filter((r) => kinds.includes(r.kind));

  async function saveGroup() {
    if (!group) return;
    const r = await m.run("/api/admin/pricing/special-dates", "POST", {
      resourceIds: group.resourceIds,
      label: group.label,
      dates: group.dates,
      price: Number(group.price),
      priority: group.priority,
    });
    if (r) {
      setGroup(null);
      reload();
    }
  }

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
      <PageTitle title={special ? "الأسعار الخاصة والمواسم" : "الأسعار الأساسية"}>
        {special && (
          <Button variant="secondary" onClick={() => { setEditing(null); setGroup({ resourceIds: res?.resources.filter((r) => r.kind === "FULL").map((r) => r.id) ?? [], label: "", dates: [], next: "", price: "", priority: 0 }); }}>
            <CalendarPlus className="size-4" /> سعر لمجموعة أيام
          </Button>
        )}
        <Button onClick={() => { setGroup(null); setEditing({ ...emptyRule, kind: kinds[0]!, resourceId: res?.resources[0]?.id ?? "" }); }}>
          <Plus className="size-4" /> {special ? "سعر خاص أو موسم" : "قاعدة سعر"}
        </Button>
      </PageTitle>
      <p className="mb-4 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7">
        {special
          ? "سعر لتواريخ محددة (إجازات المدارس، الأعياد، الإجازات الرسمية، المناسبات، العروض) دون تغيير السعر الأساسي. عند التعارض: «سعر خاص (مناسبة)» يتقدم على «موسم / فترة»، ثم الأولوية الأعلى، ثم الأحدث. الحجوزات السابقة تحتفظ بسعرها ولا تتأثر بأي تعديل."
          : "سعر كل يوم من أيام الأسبوع. أي يوم بلا سعر لا يمكن حجزه. الأسعار لليوم الواحد بالريال. للأسعار الخاصة بتواريخ معينة استخدم «الأسعار الخاصة والمواسم»."}
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
                {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
              </select>
            </Field>
            <Field label="السعر لليوم (ريال)"><input type="number" min={0} step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} className={inputClass} /></Field>
            <Field label={special ? "اسم المناسبة أو العرض" : "الاسم (اختياري)"} hint={special ? "مثل «عيد الفطر» أو «إجازة المدارس»" : "مثل «موسم الشتاء»"}><input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className={inputClass} /></Field>
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
            {special && (
              <Field label="الأولوية" hint="الأعلى يتقدم عند تعارض قاعدتين من نفس النوع">
                <input type="number" min={0} max={1000} value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} className={inputClass} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="size-4 accent-jood-green" /> مفعّلة</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!editing.resourceId || editing.price === ""}>حفظ</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {group && (
        <Card title="سعر خاص لمجموعة أيام" className="mb-5">
          <p className="-mt-2 mb-4 text-sm text-jood-ink/60">أضف الأيام واحدًا واحدًا (مثل أيام العيد أو إجازة رسمية متفرقة)، وسيُطبق السعر نفسه على كل يوم.</p>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="اسم المناسبة أو العرض"><input value={group.label} onChange={(e) => setGroup({ ...group, label: e.target.value })} className={inputClass} /></Field>
            <Field label="السعر لليوم (ريال)"><input type="number" min={0} step="0.01" value={group.price} onChange={(e) => setGroup({ ...group, price: e.target.value })} className={inputClass} /></Field>
            <Field label="الأولوية"><input type="number" min={0} max={1000} value={group.priority} onChange={(e) => setGroup({ ...group, priority: Number(e.target.value) })} className={inputClass} /></Field>
            <fieldset className="md:col-span-3">
              <legend className="text-sm font-medium text-jood-ink/80">يُطبق على</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {res?.resources.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-jood-green" checked={group.resourceIds.includes(r.id)} onChange={(e) => setGroup({ ...group, resourceIds: e.target.checked ? [...group.resourceIds, r.id] : group.resourceIds.filter((x) => x !== r.id) })} />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="أضف يومًا"><input type="date" value={group.next} onChange={(e) => setGroup({ ...group, next: e.target.value })} className={inputClass} /></Field>
                <Button variant="secondary" disabled={!group.next || group.dates.includes(group.next)} onClick={() => setGroup({ ...group, dates: [...group.dates, group.next].sort(), next: "" })}><Plus className="size-4" /> إضافة اليوم</Button>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="الأيام المختارة">
                {group.dates.map((d) => (
                  <li key={d} className="flex items-center gap-1 rounded-full bg-jood-gold/15 px-3 py-1 text-sm">
                    <span dir="ltr">{d}</span>
                    <button type="button" aria-label={`إزالة ${d}`} onClick={() => setGroup({ ...group, dates: group.dates.filter((x) => x !== d) })}><X className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={saveGroup} disabled={!group.label.trim() || group.price === "" || group.dates.length === 0 || group.resourceIds.length === 0}>حفظ</Button>
            <Button variant="ghost" onClick={() => setGroup(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {loading && !rules ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {res?.resources.map((r) => {
            const list = (rules?.filter((x) => x.resourceId === r.id) ?? []).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
            return (
              <Card key={r.id} title={r.name}>
                {list.length === 0 ? (
                  <Empty>{special ? "لا توجد أسعار خاصة — يُطبق السعر الأساسي." : <>لا توجد أسعار — {r.kind === "PART" ? "هذا الجزء غير قابل للحجز حتى تضيف سعرًا." : "لا يمكن الحجز."}</>}</Empty>
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
                            {x.priority > 0 && ` · أولوية ${x.priority}`}
                            {!x.active && " · موقوفة"}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {special && (
                            <Button variant="ghost" aria-label={x.active ? "إيقاف" : "تفعيل"} onClick={async () => { if (await m.run(`/api/admin/pricing/${x.id}/active`, "PATCH", { active: !x.active })) reload(); }}>
                              {x.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                            </Button>
                          )}
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

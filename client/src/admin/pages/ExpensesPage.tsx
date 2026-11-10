import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi, useMutation } from "../ui";

interface Expense { id: string; title: string; category: string; date: string; amount: number; notes: string | null }
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const empty = () => ({ title: "", category: "أخرى", date: today(), amount: "", notes: "" });

/** «المصاريف»: record, edit and delete expenses; filter by month and category. */
export default function ExpensesPage() {
  const [month, setMonth] = useState("");
  const [category, setCategory] = useState("");
  const range = month ? `from=${month}-01&to=${month}-31` : "";
  const { data, error, loading, reload } = useApi<{ items: Expense[]; total: number; categories: string[] }>(`/api/admin/expenses?${range}${category ? `&category=${encodeURIComponent(category)}` : ""}`);
  const m = useMutation();
  const [form, setForm] = useState<(ReturnType<typeof empty> & { id?: string }) | null>(null);

  async function save() {
    if (!form) return;
    const body = { title: form.title, category: form.category, date: form.date, amount: Number(form.amount), notes: form.notes.trim() || null };
    const ok = form.id ? await m.run(`/api/admin/expenses/${form.id}`, "PUT", body) : await m.run("/api/admin/expenses", "POST", body);
    if (ok) {
      setForm(null);
      reload();
    }
  }

  return (
    <>
      <PageTitle title="المصاريف">
        <Button onClick={() => setForm(empty())}><Plus className="size-4" /> مصروف</Button>
      </PageTitle>
      <ErrorNote>{error || m.error}</ErrorNote>
      {form && (
        <Card title={form.id ? "تعديل مصروف" : "مصروف جديد"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="البند / الوصف"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} /></Field>
            <Field label="المبلغ (ريال)"><input type="number" min={0.01} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} /></Field>
            <Field label="التصنيف">
              <input list="expense-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass} />
              <datalist id="expense-categories">{data?.categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="التاريخ"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} /></Field>
            <Field label="ملاحظات (اختياري)" className="md:col-span-2"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} /></Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!form.title.trim() || !form.amount || !form.category.trim()}>حفظ</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>إلغاء</Button>
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="الشهر"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} /></Field>
          <Field label="التصنيف">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">الكل</option>
              {data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {data && <p className="ms-auto font-display text-lg font-semibold text-jood-green">الإجمالي: {money(data.total)}</p>}
        </div>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty>لا توجد مصاريف.</Empty> : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <span className="font-medium">{e.title}</span>
                  <span className="ms-2 rounded-full bg-jood-gold/15 px-2 py-0.5 text-xs">{e.category}</span>
                  <div className="text-xs text-jood-ink/60">{e.date}{e.notes ? ` · ${e.notes.split("\n")[0]}` : ""}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="me-2 font-semibold">{money(e.amount)}</span>
                  <Button variant="ghost" aria-label={`تعديل ${e.title}`} onClick={() => setForm({ id: e.id, title: e.title, category: e.category, date: e.date, amount: String(e.amount), notes: e.notes ?? "" })}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" aria-label={`حذف ${e.title}`} onClick={async () => { if (confirm(`حذف «${e.title}»؟`) && (await m.run(`/api/admin/expenses/${e.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

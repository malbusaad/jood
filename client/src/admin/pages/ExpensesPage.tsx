import { useState } from "react";
import { Pencil, Plus, Repeat, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi, useMutation } from "../ui";

interface Expense { id: string; title: string; category: string; date: string; amount: number; notes: string | null; recurring: boolean }
interface ExpensesResponse {
  items: Expense[];
  total: number;
  periodTotal: number;
  recurringTotal: number;
  byCategory: Record<string, number>;
  categories: string[];
  rules: { category: string; words: string[] }[];
  canAutoCategorize: number;
}

const AUTO = "";
const OTHER = "أخرى";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const empty = () => ({ title: "", category: AUTO, date: today(), amount: "", notes: "", recurring: false });
const dateFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Last day of a "YYYY-MM" month (30 November, 28/29 February…). */
export function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Same matching as the server (services/expenses.ts), using the rules it sends. */
function normalizeAr(s: string) {
  return s.toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/\s+/g, " ").trim();
}
function suggest(title: string, rules: ExpensesResponse["rules"]) {
  const t = ` ${normalizeAr(title)} `;
  for (const r of rules) {
    if (r.words.some((w) => new RegExp(`(^|[\\s،,.-])(ال|لل|بال|و|ب|ل)?${w}${w.length <= 3 ? "(?=$|[\\s،,.-])" : ""}`).test(t))) return r.category;
  }
  return OTHER;
}

/** «المصاريف»: record expenses (one-off or recurring every month), categorized automatically. */
export default function ExpensesPage() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<"" | "recurring" | "once">("");
  const range = month ? `from=${month}-01&to=${monthEnd(month)}` : "";
  const { data, error, loading, reload } = useApi<ExpensesResponse>(
    `/api/admin/expenses?${range}${category ? `&category=${encodeURIComponent(category)}` : ""}${kind ? `&kind=${kind}` : ""}`,
  );
  const m = useMutation();
  const [form, setForm] = useState<(ReturnType<typeof empty> & { id?: string }) | null>(null);
  const auto = form && data ? suggest(form.title, data.rules) : OTHER;

  async function save() {
    if (!form) return;
    const body = { title: form.title, category: form.category || undefined, date: form.date, amount: Number(form.amount), notes: form.notes.trim() || null, recurring: form.recurring };
    const ok = form.id ? await m.run(`/api/admin/expenses/${form.id}`, "PUT", body) : await m.run("/api/admin/expenses", "POST", body);
    if (ok) {
      setForm(null);
      reload();
    }
  }

  const cats = data ? Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]) : [];
  const max = Math.max(1, ...cats.map(([, v]) => v));

  return (
    <>
      <PageTitle title="المصاريف">
        <Button onClick={() => setForm(empty())}><Plus className="size-4" /> مصروف</Button>
      </PageTitle>
      <ErrorNote>{error || m.error}</ErrorNote>

      {form && (
        <Card title={form.id ? "تعديل مصروف" : "مصروف جديد"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="البند / الوصف" hint="مثل: فاتورة الكهرباء، راتب الحارس، صيانة المكيف"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} autoFocus /></Field>
            <Field label="المبلغ (ريال)"><input type="number" min={0.01} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} /></Field>
            <Field label="التصنيف" hint={form.category === AUTO ? <span className="inline-flex items-center gap-1 text-emerald-700"><Sparkles aria-hidden className="size-3" /> يُصنَّف تلقائيًا: {auto}</span> : undefined}>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                <option value={AUTO}>تلقائي حسب الوصف</option>
                {data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="التاريخ"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} /></Field>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-jood-ink/80">نوع المصروف</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="نوع المصروف">
                {([[false, "مرة واحدة", "يُسجَّل هذه المرة فقط"], [true, "مصروف دائم (شهري)", "يُضاف تلقائيًا كل شهر في نفس اليوم حتى توقفه"]] as const).map(([v, l, h]) => (
                  <button key={l} type="button" role="radio" aria-checked={form.recurring === v} onClick={() => setForm({ ...form, recurring: v })}
                    className={`rounded-xl border p-3 text-start transition ${form.recurring === v ? "border-jood-green bg-jood-green/5 ring-1 ring-jood-green" : "border-jood-green/20 hover:bg-jood-beige/50"}`}>
                    <span className="flex items-center gap-1.5 text-sm font-medium">{v && <Repeat aria-hidden className="size-4 text-jood-gold" />}{l}</span>
                    <span className="mt-0.5 block text-xs text-jood-ink/60">{h}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="ملاحظات (اختياري)" className="md:col-span-2"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} /></Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!form.title.trim() || !form.amount}>حفظ</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="ملخص المصاريف">
          {[
            ["إجمالي المصاريف", data.periodTotal, "text-jood-green"],
            ["مصاريف دائمة", data.recurringTotal, "text-jood-gold"],
            ["مصاريف متغيرة", Math.round((data.periodTotal - data.recurringTotal) * 100) / 100, "text-jood-ink"],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-jood-green/10">
              <p className="text-xs text-jood-ink/60">{label}{month ? "" : " (كل الفترات)"}</p>
              <p className={`mt-1 font-display text-2xl font-semibold ${cls}`}>{money(v as number)}</p>
            </div>
          ))}
        </div>
      )}

      {data && data.canAutoCategorize > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <span className="flex items-center gap-2"><Wand2 aria-hidden className="size-4" /> {data.canAutoCategorize} مصروف في «أخرى» يمكن تصنيفها تلقائيًا حسب وصفها.</span>
          <Button variant="secondary" busy={m.busy} onClick={async () => { if (await m.run("/api/admin/expenses/auto-categorize", "POST")) reload(); }}>صنّفها الآن</Button>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="الشهر"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} /></Field>
          <Field label="النوع">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass}>
              <option value="">الكل</option>
              <option value="recurring">دائمة</option>
              <option value="once">مرة واحدة</option>
            </select>
          </Field>
          {month && <Button variant="ghost" onClick={() => setMonth("")}>كل الفترات</Button>}
          {data && <p className="ms-auto font-display text-lg font-semibold text-jood-green">المعروض: {money(data.total)}</p>}
        </div>

        {cats.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="حسب التصنيف">
            <button type="button" onClick={() => setCategory("")} aria-pressed={category === ""}
              className={`rounded-full px-3 py-1.5 text-xs ${category === "" ? "bg-jood-green text-jood-beige" : "bg-jood-beige/70 text-jood-ink/75 hover:bg-jood-beige"}`}>الكل</button>
            {cats.map(([c, v]) => (
              <button key={c} type="button" onClick={() => setCategory(category === c ? "" : c)} aria-pressed={category === c}
                className={`relative overflow-hidden rounded-full px-3 py-1.5 text-xs ${category === c ? "bg-jood-green text-jood-beige" : "bg-jood-beige/70 text-jood-ink/80 hover:bg-jood-beige"}`}>
                <span aria-hidden className="absolute inset-y-0 start-0 bg-jood-gold/20" style={{ width: category === c ? 0 : `${(v / max) * 100}%` }} />
                <span className="relative">{c} · {money(v)}</span>
              </button>
            ))}
          </div>
        )}

        {loading && !data ? <Loading /> : !data?.items.length ? <Empty>لا توجد مصاريف في هذه الفترة.</Empty> : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-jood-beige text-center text-[10px] leading-tight text-jood-ink/70">
                    {dateFmt.format(new Date(`${e.date}T00:00:00Z`)).split(" ").slice(0, 2).join(" ")}
                  </div>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{e.title}</span>
                      <span className="rounded-full bg-jood-gold/15 px-2 py-0.5 text-[11px]">{e.category}</span>
                      {e.recurring && <span className="inline-flex items-center gap-1 rounded-full bg-jood-green/10 px-2 py-0.5 text-[11px] text-jood-green"><Repeat aria-hidden className="size-3" /> دائم</span>}
                    </p>
                    {e.notes && <p className="truncate text-xs text-jood-ink/55">{e.notes.split("\n")[0]}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="me-2 font-semibold">{money(e.amount)}</span>
                  <Button variant="ghost" aria-label={`تعديل ${e.title}`} onClick={() => setForm({ id: e.id, title: e.title, category: e.category, date: e.date, amount: String(e.amount), notes: e.notes ?? "", recurring: e.recurring })}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" aria-label={`حذف ${e.title}`} onClick={async () => { if (confirm(`حذف «${e.title}»؟`) && (await m.run(`/api/admin/expenses/${e.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data?.items.some((e) => e.recurring) && (
          <p className="mt-3 text-xs text-jood-ink/55">المصروف الدائم يُضاف تلقائيًا كل شهر في نفس اليوم. لإيقافه: عدّل آخر نسخة منه واختر «مرة واحدة».</p>
        )}
      </Card>
    </>
  );
}

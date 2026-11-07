import { useState } from "react";
import { Link } from "react-router";
import { History, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, inputClass, money, useApi, useMutation } from "../ui";
import { STATUS } from "../labels";
import type { BookingStatus } from "../types";

interface DiscountCode {
  id: string;
  code: string;
  label: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  startDate: string | null;
  endDate: string | null;
  maxUses: number | null;
  usedCount: number;
  onePerGuest: boolean;
  daysOfWeek: number[];
  includeSpecialDays: boolean;
  scope: "ALL" | "FULL_ONLY";
  minAmount: number | null;
  active: boolean;
  totalRedemptions?: number;
}

interface Redemption {
  id: string;
  amount: number;
  status: "ACTIVE" | "RELEASED";
  createdAt: string;
  releasedAt: string | null;
  guestName: string;
  booking: { id: string; reference: string; status: BookingStatus; startDate: string };
}

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const empty = {
  code: "",
  label: "",
  type: "PERCENT" as DiscountCode["type"],
  value: "",
  startDate: "",
  endDate: "",
  maxUses: "",
  onePerGuest: false,
  daysOfWeek: [] as number[],
  includeSpecialDays: true,
  scope: "ALL" as DiscountCode["scope"],
  minAmount: "",
  active: true,
};
type Form = typeof empty & { id?: string };

function toForm(c: DiscountCode): Form {
  return {
    id: c.id,
    code: c.code,
    label: c.label ?? "",
    type: c.type,
    value: String(c.value),
    startDate: c.startDate ?? "",
    endDate: c.endDate ?? "",
    maxUses: c.maxUses === null ? "" : String(c.maxUses),
    onePerGuest: c.onePerGuest,
    daysOfWeek: c.daysOfWeek,
    includeSpecialDays: c.includeSpecialDays,
    scope: c.scope,
    minAmount: c.minAmount === null ? "" : String(c.minAmount),
    active: c.active,
  };
}

function describe(c: DiscountCode) {
  const parts = [c.type === "PERCENT" ? `${c.value}%` : money(c.value)];
  parts.push(c.scope === "FULL_ONLY" ? "الحجز الكامل فقط" : "الكامل والجزئي");
  if (c.daysOfWeek.length > 0 && c.daysOfWeek.length < 7) parts.push(c.daysOfWeek.map((d) => DAYS[d]).join("، "));
  if (!c.includeSpecialDays) parts.push("لا يشمل المناسبات والمواسم");
  if (c.minAmount) parts.push(`حد أدنى ${money(c.minAmount)}`);
  if (c.onePerGuest) parts.push("مرة لكل ضيف");
  if (c.startDate || c.endDate) parts.push(`صالح ${c.startDate ? `من ${c.startDate}` : ""} ${c.endDate ? `حتى ${c.endDate}` : ""}`.trim());
  return parts.join(" · ");
}

/** «الخصومات وأكواد الخصم»: every check and amount is computed on the server. */
export default function DiscountsPage() {
  const { data: codes, error, loading, reload } = useApi<DiscountCode[]>("/api/admin/discounts");
  const m = useMutation();
  const [form, setForm] = useState<Form | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    const body = {
      code: form.code,
      label: form.label.trim() || null,
      type: form.type,
      value: Number(form.value),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      maxUses: form.maxUses === "" ? null : Number(form.maxUses),
      onePerGuest: form.onePerGuest,
      daysOfWeek: form.daysOfWeek,
      includeSpecialDays: form.includeSpecialDays,
      scope: form.scope,
      minAmount: form.minAmount === "" ? null : Number(form.minAmount),
      active: form.active,
    };
    const r = form.id ? await m.run(`/api/admin/discounts/${form.id}`, "PUT", body) : await m.run("/api/admin/discounts", "POST", body);
    if (r) {
      setForm(null);
      reload();
    }
  }

  return (
    <>
      <PageTitle title="الخصومات وأكواد الخصم">
        <Button onClick={() => setForm({ ...empty })}><Plus className="size-4" /> كود خصم</Button>
      </PageTitle>
      <p className="mb-4 rounded-xl bg-jood-beige px-4 py-3 text-sm leading-7">
        الخصم على مبلغ الحجز فقط؛ التأمين ثابت لا يدخل في الخصم. يُحتسب الاستخدام عند إرسال طلب الحجز، ويعود للكود تلقائيًا إذا أُلغي الحجز أو رُفض أو انتهت مهلته.
        تعديل الكود لا يغيّر الحجوزات السابقة.
      </p>
      <ErrorNote>{error || m.error}</ErrorNote>

      {form && (
        <Card title={form.id ? `تعديل الكود ${form.code}` : "كود خصم جديد"} className="mb-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="الكود" hint="أحرف إنجليزية وأرقام، مثل JOOD10">
              <input dir="ltr" value={form.code} maxLength={30} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={`${inputClass} text-end uppercase`} />
            </Field>
            <Field label="الاسم (اختياري)" hint="للتذكير فقط، مثل «عرض الصيف»">
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputClass} />
            </Field>
            <Field label="نوع الخصم">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form["type"] })} className={inputClass}>
                <option value="PERCENT">نسبة مئوية %</option>
                <option value="FIXED">مبلغ ثابت (ريال)</option>
              </select>
            </Field>
            <Field label={form.type === "PERCENT" ? "النسبة %" : "المبلغ (ريال)"}>
              <input type="number" min={0.01} max={form.type === "PERCENT" ? 100 : undefined} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={inputClass} />
            </Field>
            <Field label="بداية الصلاحية (اختياري)"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} /></Field>
            <Field label="نهاية الصلاحية (اختياري)" hint="يعمل حتى نهاية هذا اليوم"><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} /></Field>
            <Field label="الحد الأقصى للاستخدامات" hint="فارغ = بلا حد، 1 = مرة واحدة فقط">
              <input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className={inputClass} />
            </Field>
            <Field label="الحد الأدنى لمبلغ الحجز (اختياري)">
              <input type="number" min={0} step="0.01" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} className={inputClass} />
            </Field>
            <Field label="ينطبق على">
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Form["scope"] })} className={inputClass}>
                <option value="ALL">الحجز الكامل والجزئي</option>
                <option value="FULL_ONLY">الحجز الكامل فقط</option>
              </select>
            </Field>
            <fieldset className="md:col-span-3">
              <legend className="text-sm font-medium text-jood-ink/80">الأيام <span className="font-normal text-jood-ink/55">(اتركها كلها فارغة لتشمل كل الأيام)</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DAYS.map((d, i) => {
                  const on = form.daysOfWeek.includes(i);
                  return (
                    <label key={d} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${on ? "border-jood-green bg-jood-green text-jood-beige" : "border-jood-green/25"}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => setForm({ ...form, daysOfWeek: on ? form.daysOfWeek.filter((x) => x !== i) : [...form.daysOfWeek, i] })} />
                      {d}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.includeSpecialDays} onChange={(e) => setForm({ ...form, includeSpecialDays: e.target.checked })} className="size-4 accent-jood-green" /> يشمل أيام الإجازات والمناسبات</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.onePerGuest} onChange={(e) => setForm({ ...form, onePerGuest: e.target.checked })} className="size-4 accent-jood-green" /> مرة واحدة لكل ضيف</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4 accent-jood-green" /> مفعّل</label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={save} disabled={!form.code.trim() || form.value === ""}>حفظ</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>إلغاء</Button>
          </div>
        </Card>
      )}

      {loading && !codes ? (
        <Loading />
      ) : !codes?.length ? (
        <Card><Empty>لا توجد أكواد خصم بعد.</Empty></Card>
      ) : (
        <Card>
          <ul className="-mx-5 -my-2 divide-y divide-jood-green/10">
            {codes.map((c) => (
              <li key={c.id} className={`px-5 py-3 ${c.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span dir="ltr" className="font-mono text-lg font-semibold text-jood-green">{c.code}</span>
                    {c.label && <span className="ms-2 text-sm">{c.label}</span>}
                    {!c.active && <span className="ms-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">موقوف</span>}
                    <p className="text-xs text-jood-ink/60">{describe(c)}</p>
                    <p className="text-xs text-jood-ink/60">الاستخدامات: {c.usedCount}{c.maxUses !== null ? ` من ${c.maxUses}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" aria-label={`سجل استخدام ${c.code}`} onClick={() => setHistoryOf(historyOf === c.id ? null : c.id)}><History className="size-4" /></Button>
                    <Button variant="ghost" aria-label={c.active ? `إيقاف ${c.code}` : `تفعيل ${c.code}`} onClick={async () => { if (await m.run(`/api/admin/discounts/${c.id}/active`, "PATCH", { active: !c.active })) reload(); }}>
                      {c.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </Button>
                    <Button variant="ghost" aria-label={`تعديل ${c.code}`} onClick={() => setForm(toForm(c))}><Pencil className="size-4" /></Button>
                    {!c.totalRedemptions && (
                      <Button variant="ghost" aria-label={`حذف ${c.code}`} onClick={async () => { if (confirm(`حذف الكود ${c.code}؟`) && (await m.run(`/api/admin/discounts/${c.id}`, "DELETE"))) reload(); }}><Trash2 className="size-4" /></Button>
                    )}
                  </div>
                </div>
                {historyOf === c.id && <RedemptionLog id={c.id} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function RedemptionLog({ id }: { id: string }) {
  const { data, loading } = useApi<{ redemptions: Redemption[] }>(`/api/admin/discounts/${id}`);
  if (loading && !data) return <Loading />;
  if (!data?.redemptions.length) return <p className="mt-2 text-sm text-jood-ink/60">لم يُستخدم بعد.</p>;
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-start text-xs text-jood-ink/55">
        <tr><th className="py-1 text-start">الحجز</th><th className="text-start">الضيف</th><th className="text-start">الخصم</th><th className="text-start">الحالة</th></tr>
      </thead>
      <tbody>
        {data.redemptions.map((r) => (
          <tr key={r.id} className="border-t border-jood-green/10">
            <td className="py-1.5"><Link to={`/admin/bookings/${r.booking.id}`} dir="ltr" className="text-jood-green underline">{r.booking.reference}</Link></td>
            <td>{r.guestName}</td>
            <td>{money(r.amount)}</td>
            <td>{r.status === "ACTIVE" ? `محتسب · ${STATUS[r.booking.status].label}` : "أُعيد للكود (أُلغي الحجز)"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

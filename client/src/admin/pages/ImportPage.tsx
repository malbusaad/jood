import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button, Card, ErrorNote, PageTitle, money, useMutation } from "../ui";

interface Summary {
  bookings: number;
  byStatus: Record<string, number>;
  skippedExisting: number;
  expenses: number;
  skippedExpenses: number;
  newCustomers: number;
  existingCustomers: number;
  bookingValueConfirmed: number;
  received: number;
  expensesTotal: number;
  upcoming: { ref: string; name: string; dates: string[]; total: number; received: number; status: string }[];
}
const STATUS: Record<string, string> = { COMPLETED: "مكتملة (سابقة)", CONFIRMED: "مؤكدة قادمة", NEW: "طلبات قادمة", EXPIRED: "طلبات معلقة انتهى موعدها", CANCELLED: "ملغاة" };

/** «استيراد السجل السابق»: the owner uploads the workbook, sees exactly what will be added, then confirms. */
export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<{ summary: Summary; issues: string[] } | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const m = useMutation();

  async function choose(f: File) {
    setPreview(null);
    setDone(null);
    m.setError(null);
    if (f.size > 5 * 1024 * 1024) return m.setError("حجم الملف أكبر من 5 ميجابايت");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    setFile({ name: f.name, data });
    const p = await m.run<{ summary: Summary; issues: string[] }>("/api/admin/import/preview", "POST", { data });
    if (p) setPreview(p);
  }

  async function commit() {
    if (!file || !preview) return;
    if (!confirm(`استيراد ${preview.summary.bookings} حجزًا و${preview.summary.expenses} مصروفًا؟`)) return;
    const r = await m.run<{ summary: Summary }>("/api/admin/import/commit", "POST", { data: file.data });
    if (r) {
      setDone(r.summary);
      setPreview(null);
      setFile(null);
    }
  }

  const s = preview?.summary;
  return (
    <>
      <PageTitle title="استيراد السجل السابق" />
      <Card>
        <p className="text-sm leading-7">
          ارفع ملف «نسخة البيانات الشاملة» (Excel). تظهر لك معاينة كاملة بما سيُضاف، ولا يُحفظ أي شيء قبل ضغطك «تأكيد الاستيراد».
          الملف يُقرأ ولا يُخزَّن، وإعادة رفع نفس الملف لا تكرر أي سجل.
        </p>
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="ملف السجل السابق" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void choose(f); }} />
        <Button className="mt-4" variant="secondary" busy={m.busy && !preview} onClick={() => fileRef.current?.click()}><Upload className="size-4" /> اختيار الملف</Button>
        {file && <p className="mt-2 text-xs text-jood-ink/60"><FileSpreadsheet aria-hidden className="me-1 inline size-4" />{file.name}</p>}
        <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
      </Card>

      {s && (
        <Card title="المعاينة — لم يُحفظ شيء بعد" className="mt-5">
          <ul className="space-y-1 text-sm leading-7">
            <li>الحجوزات الجديدة: <strong>{s.bookings}</strong>{s.skippedExisting ? ` (و${s.skippedExisting} مستوردة مسبقًا ستُتجاهل)` : ""}</li>
            {Object.entries(s.byStatus).map(([k, v]) => <li key={k} className="ms-4 text-jood-ink/75">{STATUS[k] ?? k}: {v}</li>)}
            <li>العملاء: <strong>{s.newCustomers}</strong> جديد{s.existingCustomers ? `، و${s.existingCustomers} موجود مسبقًا (يُربط به)` : ""}</li>
            <li>المصاريف: <strong>{s.expenses}</strong> بند بمجموع {money(s.expensesTotal)}{s.skippedExpenses ? ` (و${s.skippedExpenses} مستوردة مسبقًا)` : ""}</li>
            <li>قيمة الحجوزات المؤكدة: {money(s.bookingValueConfirmed)} — المبالغ المستلمة المسجلة (العربون/المدفوع): {money(s.received)}</li>
          </ul>
          {s.upcoming.length > 0 && (
            <>
              <h3 className="mt-4 font-medium">الحجوزات القادمة (ستُغلق أيامها في الموقع للاستراحة كاملة)</h3>
              <ul className="mt-2 divide-y divide-jood-green/10 text-sm">
                {s.upcoming.map((u) => (
                  <li key={u.ref} className="py-2">
                    {u.name} — <span dir="ltr">{u.dates.join("، ")}</span> — {money(u.total)}، المستلم {money(u.received)}، المتبقي {money(u.total - u.received)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview!.issues.length > 0 && (
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">ملاحظات ({preview!.issues.length})</p>
              <ul className="mt-1 list-inside list-disc text-amber-900">{preview!.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}
          <p className="mt-4 text-xs leading-6 text-jood-ink/60">
            الحجوزات المستوردة تُعلَّم «سجل سابق»، ولا تُرسل لها أي رسائل. المبالغ المستلمة تُسجل دفعات متحقق منها (الطريقة غير محددة في الملف).
            الحجوزات ذات الأيام المتفرقة تُحفظ كحجز واحد بأيامه.
          </p>
          <Button className="mt-4" busy={m.busy} onClick={commit} disabled={s.bookings === 0 && s.expenses === 0}>تأكيد الاستيراد</Button>
        </Card>
      )}

      {done && (
        <Card title="تم الاستيراد" className="mt-5">
          <p className="text-sm leading-7 text-emerald-800">
            أُضيف {done.bookings} حجزًا و{done.expenses} مصروفًا. تجدها في «الحجوزات» و«الضيوف» و«المصاريف» و«التقارير المالية».
          </p>
        </Card>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from "lucide-react";
import { Button, Card, ErrorNote, Field, inputClass, useApi, useMutation } from "../ui";

export interface TickerValue {
  enabled: boolean;
  items: { id: string; text: string; active: boolean }[];
  secondsPerItem: number;
  direction: "rtl" | "ltr";
  mobile: "animate" | "static";
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** News ticker: phrases (add, edit, enable/disable, reorder, delete), speed, direction and small-screen behaviour. */
export function TickerEditor({ initial, canEdit }: { initial: TickerValue; canEdit: boolean }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => setV(initial), [initial]);

  const update = (i: number, patch: Partial<TickerValue["items"][number]>) => setV({ ...v, items: v.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const items = [...v.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j]!, items[i]!];
    setV({ ...v, items });
  };

  async function save() {
    const body = { ...v, items: v.items.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text) };
    const r = await m.run<{ value: TickerValue }>("/api/admin/settings/ticker", "PUT", body);
    if (r) {
      setV(r.value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Card title="الشريط الإخباري المتحرك">
      <p className="-mt-2 mb-4 text-sm text-jood-ink/60">يظهر أعلى كل صفحات الموقع. العبارات تظهر بالترتيب أدناه، والمعطّلة لا تظهر. يتوقف الشريط عند مرور المؤشر عليه.</p>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.enabled} disabled={!canEdit} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="size-5 accent-jood-green" />
        إظهار الشريط
      </label>
      <ol className="space-y-2">
        {v.items.map((item, i) => (
          <li key={item.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-jood-green/10 p-2 ${item.active ? "" : "opacity-60"}`}>
            <span className="w-6 text-center text-sm text-jood-ink/50">{i + 1}</span>
            <input aria-label={`العبارة ${i + 1}`} value={item.text} maxLength={200} disabled={!canEdit} onChange={(e) => update(i, { text: e.target.value })} className={`${inputClass} min-w-0 flex-1 basis-56`} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={item.active} disabled={!canEdit} onChange={(e) => update(i, { active: e.target.checked })} className="size-4 accent-jood-green" />
              مفعّلة
            </label>
            {canEdit && (
              <span className="flex">
                <Button variant="ghost" aria-label={`نقل العبارة ${i + 1} للأعلى`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" aria-label={`نقل العبارة ${i + 1} للأسفل`} disabled={i === v.items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button variant="ghost" aria-label={`حذف العبارة ${i + 1}`} onClick={() => setV({ ...v, items: v.items.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <Button className="mt-3" variant="secondary" disabled={v.items.length >= 30} onClick={() => setV({ ...v, items: [...v.items, { id: newId(), text: "", active: true }] })}>
          <Plus className="size-4" /> إضافة عبارة
        </Button>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <Field label="السرعة" hint="ثوانٍ لكل عبارة: الأقل أسرع">
          <input type="number" min={3} max={30} value={v.secondsPerItem} disabled={!canEdit} onChange={(e) => setV({ ...v, secondsPerItem: Number(e.target.value) })} className={inputClass} />
        </Field>
        <Field label="الاتجاه">
          <select value={v.direction} disabled={!canEdit} onChange={(e) => setV({ ...v, direction: e.target.value as TickerValue["direction"] })} className={inputClass}>
            <option value="rtl">من اليسار إلى اليمين (مناسب للعربية)</option>
            <option value="ltr">من اليمين إلى اليسار</option>
          </select>
        </Field>
        <Field label="على الجوال">
          <select value={v.mobile} disabled={!canEdit} onChange={(e) => setV({ ...v, mobile: e.target.value as TickerValue["mobile"] })} className={inputClass}>
            <option value="animate">متحرك</option>
            <option value="static">ثابت: عبارة واحدة تتبدل</option>
          </select>
        </Field>
      </div>
      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button busy={m.busy} onClick={save}>حفظ</Button>
          {saved && <span className="text-sm text-emerald-700">تم الحفظ</span>}
        </div>
      )}
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

/** Upload of the official Ministry of Tourism logo supplied by the owner. */
export function LicenseLogoCard({ canEdit }: { canEdit: boolean }) {
  const [tick, setTick] = useState(0);
  const { data } = useApi<{ url: string | null }>(`/api/admin/license-logo?t=${tick}`);
  const m = useMutation();
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setLocalError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setLocalError("الشعار يجب أن يكون صورة PNG أو JPG أو WebP");
    if (file.size > 512 * 1024) return setLocalError("حجم الشعار أكبر من 512 كيلوبايت");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    if (await m.run("/api/admin/license-logo", "PUT", { data })) setTick((t) => t + 1);
  }

  return (
    <Card title="شعار وزارة السياحة">
      <p className="-mt-2 mb-4 text-sm text-jood-ink/60">ارفع الشعار الرسمي الذي لديك (PNG أو JPG أو WebP، حتى 512 كيلوبايت). لا يُستخدم أي شعار بديل؛ إن لم يُرفع تظهر علامة توثيق بسيطة.</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-40 items-center justify-center rounded-xl border border-dashed border-jood-green/20 bg-white">
          {data?.url ? <img src={data.url} alt="شعار وزارة السياحة الحالي" className="max-h-16 max-w-36 object-contain" /> : <span className="text-xs text-jood-ink/50">لم يُرفع بعد</span>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="ملف الشعار" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
            <Button variant="secondary" busy={m.busy} onClick={() => fileRef.current?.click()}><Upload className="size-4" /> {data?.url ? "استبدال الشعار" : "رفع الشعار"}</Button>
            {data?.url && (
              <Button variant="ghost" onClick={async () => { if (await m.run("/api/admin/license-logo", "DELETE")) setTick((t) => t + 1); }}><Trash2 className="size-4" /> حذف</Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-3"><ErrorNote>{localError ?? m.error}</ErrorNote></div>
    </Card>
  );
}

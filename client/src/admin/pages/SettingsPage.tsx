import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useUser } from "../auth";
import { LicenseLogoCard, TickerEditor, type TickerValue } from "./SiteExtrasSettings";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, inputClass, useApi, useMutation } from "../ui";

type Json = Record<string, unknown>;
type FieldType = "text" | "textarea" | "time" | "number" | "nullableNumber" | "url" | "tel" | "email" | "bool" | "lines" | "password" | "select";

interface FieldDef {
  path: string;
  label: string;
  type: FieldType;
  hint?: string;
  ltr?: boolean;
  rows?: number;
  options?: [string, string][];
}

interface SectionDef {
  key: string;
  title: string;
  intro?: string;
  ownerOnly?: boolean;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    key: "general",
    title: "معلومات الاستراحة",
    fields: [
      { path: "name", label: "الاسم", type: "text" },
      { path: "tagline", label: "العبارة القصيرة أعلى الصفحة", type: "text" },
      { path: "welcome", label: "العبارة الترحيبية", type: "text" },
      { path: "description", label: "الوصف المختصر", type: "textarea" },
      { path: "location.district", label: "الحي", type: "text" },
      { path: "location.city", label: "المدينة", type: "text" },
      { path: "location.country", label: "الدولة", type: "text" },
    ],
  },
  {
    key: "stay",
    title: "أوقات الدخول والخروج",
    fields: [
      { path: "checkIn", label: "وقت الدخول", type: "time" },
      { path: "checkOut", label: "وقت الخروج (من اليوم التالي)", type: "time" },
    ],
  },
  {
    key: "contact",
    title: "بيانات التواصل",
    intro: "تظهر في صفحة التواصل والصفحة الرئيسية.",
    fields: [
      { path: "phone", label: "الهاتف", type: "tel", ltr: true },
      { path: "whatsapp", label: "واتساب", type: "tel", ltr: true },
      { path: "email", label: "البريد الإلكتروني", type: "email", ltr: true },
      { path: "mapUrl", label: "رابط الموقع على الخريطة", type: "url", ltr: true },
    ],
  },
  {
    key: "gathern",
    title: "جاذر إن",
    fields: [
      { path: "url", label: "رابط صفحة الاستراحة في جاذر إن", type: "url", ltr: true, hint: "يظهر زر «الانتقال إلى جاذر إن» بعد إضافته." },
      { path: "notice", label: "تنبيه الرسوم", type: "textarea" },
    ],
  },
  {
    key: "bank",
    title: "الحساب البنكي",
    intro: "لا يظهر في الصفحات العامة. يراه الضيف فقط بعد إرسال طلب الحجز، ويُضاف إلى العقد.",
    ownerOnly: true,
    fields: [
      { path: "bankName", label: "اسم البنك", type: "text" },
      { path: "accountHolder", label: "اسم صاحب الحساب", type: "text" },
      { path: "iban", label: "رقم الآيبان", type: "text", ltr: true, hint: "SA متبوعة بـ 22 رقمًا" },
      { path: "instructions", label: "تعليمات التحويل (اختياري)", type: "textarea" },
    ],
  },
  {
    key: "bookingPolicy",
    title: "سياسة الحجز وخيارات الدفع",
    ownerOnly: true,
    fields: [
      { path: "securityDeposit", label: "مبلغ التأمين المسترد (ريال)", type: "number" },
      { path: "unpaidExpiryHours", label: "مهلة الدفع بالساعات", type: "nullableNumber", hint: "تبدأ عند تحويل الطلب إلى «بانتظار الدفع». اتركه فارغًا لإيقاف الإلغاء التلقائي." },
      { path: "maxNights", label: "أقصى عدد أيام للحجز الواحد", type: "number" },
      { path: "maxAdvanceDays", label: "أقصى مدة للحجز مقدمًا (أيام)", type: "number" },
      { path: "allowDepositPlan", label: "إتاحة خيار العربون للضيف", type: "bool" },
      { path: "depositPercent", label: "نسبة العربون من مبلغ الحجز (%)", type: "number", hint: "تُحسب بعد الخصم. التأمين منفصل." },
      { path: "balanceDueHours", label: "آخر موعد لسداد المتبقي والتأمين (ساعات قبل الدخول)", type: "number", hint: "بعده يصلك تنبيه إذا لم يكتمل السداد، والقرار لك. رمز الدخول لا يظهر للضيف حتى يكتمل السداد." },
    ],
  },
  {
    key: "cancellationPolicy",
    title: "سياسة الإلغاء",
    intro: "كل سطر بند. تظهر في صفحة الشروط وفي العقد.",
    fields: [{ path: "text", label: "النص", type: "textarea", rows: 7 }],
  },
  {
    key: "houseRules",
    title: "تعليمات الاستراحة",
    intro: "كل سطر تعليمة. تظهر في صفحة الشروط وفي العقد وبوابة الضيف.",
    fields: [{ path: "", label: "التعليمات", type: "lines", rows: 12 }],
  },
  {
    key: "guestPortal",
    title: "بوابة الضيف",
    intro: "تظهر للضيف فقط في رابطه الخاص، ويُرسل الرابط من صفحة الحجز بعد التأكيد.",
    ownerOnly: true,
    fields: [
      { path: "entryCode", label: "رمز الدخول", type: "text", ltr: true },
      { path: "wifiName", label: "اسم شبكة الواي فاي", type: "text", ltr: true },
      { path: "wifiPassword", label: "كلمة مرور الواي فاي", type: "text", ltr: true },
      { path: "departureInstructions", label: "إرشادات المغادرة (كل سطر إرشاد)", type: "lines" },
      { path: "linkGraceHours", label: "ساعات بقاء الرابط بعد وقت الخروج", type: "number" },
      { path: "showCodesFrom", label: "متى يظهر رمز الدخول والواي فاي", type: "select", options: [["CHECKIN_DAY", "يوم الدخول فقط"], ["IMMEDIATELY", "فور فتح الرابط"]] },
    ],
  },
  {
    key: "tourismLicense",
    title: "ترخيص وزارة السياحة",
    intro: "يظهر أعلى الصفحة الرئيسية بعد إدخال رقم الترخيص الحقيقي وتفعيل الإظهار.",
    fields: [
      { path: "enabled", label: "إظهار قسم الترخيص", type: "bool" },
      { path: "licenseNumber", label: "رقم الترخيص", type: "text", ltr: true },
      { path: "text", label: "العبارة", type: "text" },
    ],
  },
  {
    key: "doorLock",
    title: "قفل الباب (TTLock)",
    intro: "عند تأكيد أي حجز يُنشأ رقم سري مؤقت للباب صالح من وقت الدخول إلى وقت الخروج، ويظهر للضيف في بوابته مكان رمز الدخول الثابت، ويُحذف من القفل إذا أُلغي الحجز.",
    ownerOnly: true,
    fields: [{ path: "enabled", label: "إنشاء رقم باب لكل حجز مؤكد", type: "bool" }],
  },
  {
    key: "notifications",
    title: "إشعارات واتساب",
    intro: "يصلك إشعار بكل طلب حجز جديد في لوحة الإدارة دائمًا. للإرسال إلى واتساب أيضًا يلزم حساب WhatsApp Business API (Meta) تضاف بياناته في إعدادات الخادم.",
    ownerOnly: true,
    fields: [
      { path: "ownerWhatsapp", label: "رقم واتساب المالك", type: "tel", ltr: true },
      { path: "whatsappEnabled", label: "إرسال إشعار الطلب الجديد إلى واتساب", type: "bool" },
    ],
  },
];

function get(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((o, k) => (o as Json | undefined)?.[k], obj);
}

function set(obj: unknown, path: string, value: unknown): unknown {
  if (!path) return value;
  const [head, ...rest] = path.split(".");
  const base = (obj ?? {}) as Json;
  return { ...base, [head!]: rest.length ? set(base[head!], rest.join("."), value) : value };
}

function Input({ def, value, onChange, disabled }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const common = { disabled, className: `${inputClass} ${def.ltr ? "text-end" : ""}`, dir: def.ltr ? "ltr" : undefined } as const;
  switch (def.type) {
    case "textarea":
      return <textarea rows={def.rows ?? 3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} {...common} />;
    case "lines":
      return (
        <textarea
          rows={def.rows ?? 5}
          value={((value as string[]) ?? []).join("\n")}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          {...common}
        />
      );
    case "select":
      return (
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputClass}>
          {def.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      );
    case "bool":
      return (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="size-5 accent-jood-green" />
      );
    case "number":
      return <input type="number" min={0} value={(value as number) ?? 0} onChange={(e) => onChange(Number(e.target.value))} {...common} />;
    case "nullableNumber":
      return <input type="number" min={1} value={(value as number | null) ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} {...common} />;
    default:
      return <input type={def.type} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} {...common} />;
  }
}

function Section({ def, initial, canEdit }: { def: SectionDef; initial: unknown; canEdit: boolean }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => setValue(initial), [initial]);

  async function save() {
    // Lines fields: drop blank lines before saving.
    let v = value;
    for (const f of def.fields) if (f.type === "lines") v = set(v, f.path, ((get(v, f.path) as string[]) ?? []).map((s) => s.trim()).filter(Boolean));
    const r = await m.run<{ value: unknown }>(`/api/admin/settings/${def.key}`, "PUT", v);
    if (r) {
      setValue(r.value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Card title={def.title}>
      {def.intro && <p className="-mt-2 mb-4 text-sm text-jood-ink/60">{def.intro}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {def.fields.map((f) => (
          <Field key={f.path || def.key} label={f.label} hint={f.hint} className={f.type === "textarea" || f.type === "lines" ? "md:col-span-2" : ""}>
            <Input def={f} value={get(value, f.path)} onChange={(v) => setValue((old: unknown) => set(old, f.path, v))} disabled={!canEdit} />
          </Field>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button busy={m.busy} onClick={save}>حفظ</Button>
          {saved && <span className="text-sm text-emerald-700">تم الحفظ</span>}
        </div>
      )}
      <div className="mt-3"><ErrorNote>{m.error && `${m.error}`}</ErrorNote></div>
    </Card>
  );
}

function FaqEditor({ initial, canEdit }: { initial: { q: string; a: string }[]; canEdit: boolean }) {
  const [items, setItems] = useState(initial);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => setItems(initial), [initial]);
  return (
    <Card title="الأسئلة الشائعة">
      <ol className="space-y-4">
        {items.map((f, i) => (
          <li key={i} className="rounded-xl border border-jood-green/10 p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input aria-label={`السؤال ${i + 1}`} value={f.q} disabled={!canEdit} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} className={inputClass} />
                <textarea aria-label={`الإجابة ${i + 1}`} rows={2} value={f.a} disabled={!canEdit} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} className={inputClass} />
              </div>
              {canEdit && (
                <Button variant="ghost" aria-label="حذف السؤال" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setItems([...items, { q: "", a: "" }])}><Plus className="size-4" /> سؤال</Button>
          <Button busy={m.busy} onClick={async () => { if (await m.run("/api/admin/settings/faqs", "PUT", items.filter((x) => x.q.trim() && x.a.trim()))) { setSaved(true); setTimeout(() => setSaved(false), 2500); } }}>حفظ</Button>
          {saved && <span className="text-sm text-emerald-700">تم الحفظ</span>}
        </div>
      )}
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

const PLACEHOLDERS = [
  ["{{reference}}", "رقم الحجز"],
  ["{{issueDate}}", "تاريخ إصدار العقد"],
  ["{{guestName}}", "اسم المستأجر"],
  ["{{guestPhone}}", "جوال المستأجر"],
  ["{{guestIdNumber}}", "رقم هوية/إقامة المستأجر"],
  ["{{startDate}} / {{endDate}}", "تاريخ الدخول والخروج"],
  ["{{checkIn}} / {{checkOut}}", "وقت الدخول والخروج"],
  ["{{total}}", "مبلغ الحجز"],
  ["{{deposit}}", "مبلغ التأمين"],
  ["{{paymentDeadline}}", "مهلة الدفع"],
  ["{{bookingDetails}}", "جدول تفاصيل الحجز والأسعار (في سطر مستقل)"],
  ["{{bankDetails}}", "جدول الحساب البنكي (في سطر مستقل)"],
  ["{{houseRules}}", "قائمة التعليمات (في سطر مستقل)"],
  ["{{cancellationPolicy}}", "سياسة الإلغاء (في سطر مستقل)"],
];

function ContractEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  useEffect(() => setText(initial), [initial]);
  return (
    <Card title="نص العقد">
      <p className="-mt-2 mb-3 text-sm text-jood-ink/60">
        «# » عنوان العقد، «## » عنوان بند، «1. » بند مرقّم، «- » نقطة، وأي سطر آخر فقرة. المتغيرات يملؤها النظام من بيانات كل حجز:
      </p>
      <dl className="mb-4 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {PLACEHOLDERS.map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt dir="ltr" className="font-mono text-jood-green">{k}</dt><dd className="text-jood-ink/65">{v}</dd></div>
        ))}
      </dl>
      <textarea aria-label="نص العقد" rows={24} value={text} onChange={(e) => setText(e.target.value)} className={`${inputClass} font-mono text-[13px] leading-6`} />
      <div className="mt-3 flex items-center gap-3">
        <Button busy={m.busy} onClick={async () => { if (await m.run("/api/admin/settings/contract", "PUT", { template: text })) { setSaved(true); setTimeout(() => setSaved(false), 2500); } }}>حفظ</Button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ — ينطبق على العقود التي تُفتح من الآن</span>}
      </div>
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

function PasswordCard() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [done, setDone] = useState(false);
  const m = useMutation();
  return (
    <Card title="تغيير كلمة المرور">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="الحالية"><input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} className={inputClass} /></Field>
        <Field label="الجديدة" hint="10 أحرف على الأقل"><input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} className={inputClass} /></Field>
        <Field label="تأكيد الجديدة"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} className={inputClass} /></Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button
          busy={m.busy}
          disabled={!f.currentPassword || f.newPassword.length < 10 || f.newPassword !== f.confirm}
          onClick={async () => {
            const r = await m.run("/api/auth/change-password", "POST", { currentPassword: f.currentPassword, newPassword: f.newPassword });
            if (r !== null) {
              setF({ currentPassword: "", newPassword: "", confirm: "" });
              setDone(true);
            }
          }}
        >
          تغيير
        </Button>
        {done && <span className="text-sm text-emerald-700">تم تغيير كلمة المرور وتسجيل خروج الأجهزة الأخرى</span>}
      </div>
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

interface LockStatus {
  configured: boolean;
  enabled: boolean;
  lockId?: string;
  locks: { lockId: string; name: string; hasGateway: boolean | null; battery: number | null; authorizedAdmin: boolean }[];
  error: string | null;
}

function LockStatusCard() {
  const [tick, setTick] = useState(0);
  const { data, loading } = useApi<LockStatus>(tick ? `/api/admin/lock/status?t=${tick}` : null);
  return (
    <Card title="اختبار الاتصال بـ TTLock">
      <p className="-mt-2 mb-3 text-sm text-jood-ink/60">
        بيانات حساب TTLock (Client ID وClient Secret واسم المستخدم وكلمة المرور ورقم القفل) تُضاف في إعدادات الخادم على Render، ولا تُكتب هنا.
      </p>
      <Button variant="secondary" busy={loading && tick > 0} onClick={() => setTick((t) => t + 1)}>اختبار الاتصال</Button>
      {data && (
        <div className="mt-4 text-sm">
          {!data.configured ? (
            <p className="text-amber-800">لم تُضف بيانات TTLock في إعدادات الخادم بعد.</p>
          ) : data.error ? (
            <div className="space-y-1">
              <p className="text-red-800">تعذر الاتصال: {data.error}</p>
              {data.error.includes("10007") && (
                <p className="text-jood-ink/70">
                  TTLock رفضت الحساب. استخدم حساب تطبيق TTLock الذي يملك القفل، وليس حساب منصة المطورين؛ وإذا كان الحسابان بنفس البريد فاستخدم حسابًا آخر للتطبيق.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {data.locks.map((l) => (
                <li key={l.lockId} className={l.lockId === data.lockId ? "font-medium text-emerald-800" : ""}>
                  {l.name || l.lockId} <span dir="ltr">({l.lockId})</span>
                  {l.lockId === data.lockId && " — القفل المستخدم"}
                  {!l.authorizedAdmin && " · الحساب ليس مسؤولًا مخوّلًا على هذا القفل"}
                  {l.hasGateway === false && " · غير متصل ببوابة"}
                  {l.battery !== null && ` · البطارية ${l.battery}%`}
                </li>
              ))}
              {!data.locks.some((l) => l.lockId === data.lockId) && <li className="text-red-800">رقم القفل المحدد في الإعدادات غير موجود في الحساب.</li>}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

const TABS = [
  { id: "site", label: "الموقع", keys: ["general", "stay", "contact", "gathern"] },
  { id: "banner", label: "الشريط والترخيص", keys: ["ticker", "tourismLicense", "licenseLogo"] },
  { id: "booking", label: "الحجز والدفع", keys: ["bookingPolicy", "bank", "cancellationPolicy"] },
  { id: "rules", label: "التعليمات والأسئلة", keys: ["houseRules", "faqs"] },
  { id: "guest", label: "بوابة الضيف", keys: ["guestPortal"] },
  { id: "lock", label: "قفل الباب", keys: ["doorLock", "lockStatus"] },
  { id: "contract", label: "العقد", keys: ["contract"] },
  { id: "notify", label: "الإشعارات", keys: ["notifications"] },
  { id: "account", label: "حسابي", keys: [] },
];

export default function SettingsPage() {
  const user = useUser();
  const owner = user.role === "OWNER";
  const { data, error, loading } = useApi<Json>("/api/admin/settings");
  const [tab, setTab] = useState("site");

  const tabs = TABS.filter((t) => owner || t.keys.length === 0 || t.keys.some((k) => !SECTIONS.find((s) => s.key === k)?.ownerOnly && k !== "contract"));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  return (
    <>
      <PageTitle title="الإعدادات" />
      {!owner && <p className="mb-4 rounded-xl bg-jood-beige px-4 py-3 text-sm">تعديل الإعدادات متاح للمالك فقط.</p>}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={current.id === t.id} onClick={() => setTab(t.id)} className={`rounded-full px-4 py-1.5 text-sm ${current.id === t.id ? "bg-jood-green text-jood-beige" : "bg-white text-jood-ink/75 hover:bg-jood-gold/15"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-5" role="tabpanel">
          {current.keys.map((key) => {
            if (key === "faqs") return <FaqEditor key={key} initial={(data.faqs as { q: string; a: string }[]) ?? []} canEdit={owner} />;
            if (key === "contract") return owner ? <ContractEditor key={key} initial={(data.contract as { template: string })?.template ?? ""} /> : null;
            if (key === "lockStatus") return owner ? <LockStatusCard key={key} /> : null;
            if (key === "ticker") return <TickerEditor key={key} initial={data.ticker as TickerValue} canEdit={owner} />;
            if (key === "licenseLogo") return <LicenseLogoCard key={key} canEdit={owner} />;
            const def = SECTIONS.find((s) => s.key === key)!;
            if (def.ownerOnly && !owner) return null;
            return <Section key={key} def={def} initial={data[key]} canEdit={owner} />;
          })}
          {current.id === "account" && <PasswordCard />}
        </div>
      ) : null}
    </>
  );
}

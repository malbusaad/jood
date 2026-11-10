import { useRef, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, RotateCcw, Send, XCircle } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageTitle, dateTime, inputClass, useApi, useMutation } from "../ui";

type Kind = "REQUEST_RECEIVED" | "BOOKING_ACCEPTED" | "PAYMENT_CONFIRMED" | "REMINDER" | "ACCESS" | "PAYMENT_PENDING" | "THANK_YOU";
type MsgStatus = "SCHEDULED" | "SENDING" | "SENT" | "FAILED" | "SKIPPED" | "BLOCKED" | "DRY_RUN";
interface MessageCfg { enabled: boolean; templateName: string | null; language: string; text: string }
interface Automation {
  mode: "OFF" | "TEST" | "LIVE";
  reminderHoursBefore: number;
  accessHoursBefore: number;
  thankYouHoursAfter: number;
  messages: Record<Kind, MessageCfg>;
}
interface Status {
  connection: { configured: boolean; ok: boolean; details: { displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null } | null; error: string | null };
  mode: Automation["mode"];
  variables: Record<string, string>;
  messages: { kind: Kind; title: string; when: string; defaultText: string; metaTemplate: string }[];
}
interface LogItem {
  id: string;
  kind: Kind;
  status: MsgStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  preview: string | null;
  lastError: string | null;
  booking: { id: string; reference: string; guest: { name: string; phone: string } };
}

const STATUS_LABEL: Record<MsgStatus, { label: string; cls: string }> = {
  SCHEDULED: { label: "مجدولة", cls: "bg-sky-100 text-sky-900" },
  SENDING: { label: "قيد الإرسال", cls: "bg-sky-100 text-sky-900" },
  SENT: { label: "أُرسلت", cls: "bg-emerald-100 text-emerald-900" },
  FAILED: { label: "فشلت", cls: "bg-red-100 text-red-900" },
  SKIPPED: { label: "لم تُرسل", cls: "bg-stone-200 text-stone-800" },
  BLOCKED: { label: "مُنعت", cls: "bg-amber-100 text-amber-900" },
  DRY_RUN: { label: "تجربة (لم تُرسل)", cls: "bg-violet-100 text-violet-900" },
};
const MODE = {
  OFF: "متوقفة — لا تُرسل أي رسالة",
  TEST: "تجربة — تُجهز الرسائل وتظهر في السجل دون إرسالها",
  LIVE: "تشغيل — تُرسل للضيوف",
} as const;

export default function WhatsAppPage() {
  const { data: status, reload: reloadStatus } = useApi<Status>("/api/admin/whatsapp/status");
  const { data: settings, reload: reloadSettings } = useApi<{ whatsappAutomation: Automation }>("/api/admin/settings");
  const [filter, setFilter] = useState<MsgStatus | "">("");
  const [page, setPage] = useState(1);
  const { data: log, reload: reloadLog } = useApi<{ items: LogItem[]; total: number; pageSize: number; counts: Partial<Record<MsgStatus, number>> }>(
    `/api/admin/whatsapp/messages?page=${page}${filter ? `&status=${filter}` : ""}`,
  );
  if (!status || !settings) return <Loading />;
  return (
    <>
      <PageTitle title="أتمتة واتساب" />
      <ConnectionCard status={status} />
      <AutomationEditor
        initial={settings.whatsappAutomation}
        status={status}
        onSaved={() => {
          reloadSettings();
          reloadStatus();
        }}
      />
      <TestCard status={status} />
      <Card title="سجل الرسائل" className="mt-5">
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="تصفية حسب الحالة">
          {(["", "SCHEDULED", "SENT", "FAILED", "BLOCKED", "SKIPPED", "DRY_RUN"] as const).map((s) => (
            <button
              key={s || "all"}
              type="button"
              role="tab"
              aria-selected={filter === s}
              onClick={() => { setFilter(s); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs ${filter === s ? "bg-jood-green text-jood-beige" : "bg-white text-jood-ink/75"}`}
            >
              {s ? STATUS_LABEL[s].label : "الكل"}
              {s && log?.counts[s] ? ` (${log.counts[s]})` : ""}
            </button>
          ))}
        </div>
        {!log ? <Loading /> : log.items.length === 0 ? <Empty>لا توجد رسائل.</Empty> : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {log.items.map((m) => <LogRow key={m.id} m={m} title={status.messages.find((x) => x.kind === m.kind)?.title ?? m.kind} onChange={reloadLog} />)}
          </ul>
        )}
        {log && log.total > log.pageSize && (
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</Button>
            <Button variant="ghost" disabled={page * log.pageSize >= log.total} onClick={() => setPage(page + 1)}>التالي</Button>
          </div>
        )}
      </Card>
    </>
  );
}

function ConnectionCard({ status }: { status: Status }) {
  const c = status.connection;
  return (
    <Card title="حالة الاتصال">
      {!c.configured ? (
        <p className="text-sm leading-7">
          <XCircle aria-hidden className="me-1 inline size-4 text-amber-700" />
          حساب WhatsApp Business (Cloud API) غير مربوط بعد. تُضاف بياناته في إعدادات الخادم على Render (WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID)، وليس هنا.
        </p>
      ) : c.ok ? (
        <p className="text-sm leading-7">
          <CheckCircle2 aria-hidden className="me-1 inline size-4 text-emerald-700" />
          متصل: <span dir="ltr">{c.details?.displayPhoneNumber}</span> — {c.details?.verifiedName}
          {c.details?.qualityRating && <span className="text-jood-ink/60"> · الجودة: {c.details.qualityRating}</span>}
        </p>
      ) : (
        <p className="text-sm leading-7 text-red-800">
          <XCircle aria-hidden className="me-1 inline size-4" /> تعذر الاتصال: <span dir="ltr">{c.error}</span>
        </p>
      )}
      <p className="mt-2 text-sm">الوضع الحالي: <strong>{MODE[status.mode]}</strong></p>
    </Card>
  );
}

function AutomationEditor({ initial, status, onSaved }: { initial: Automation; status: Status; onSaved: () => void }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const m = useMutation();
  // Follow new data from the server without wiping what was just typed (no delayed reset after the first render).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setV(initial);
  }
  const areas = useRef<Partial<Record<Kind, HTMLTextAreaElement | null>>>({});

  const setMsg = (k: Kind, patch: Partial<MessageCfg>) => setV({ ...v, messages: { ...v.messages, [k]: { ...v.messages[k], ...patch } } });
  const insertVar = (k: Kind, name: string) => {
    const el = areas.current[k];
    const text = v.messages[k].text;
    const at = el?.selectionStart ?? text.length;
    setMsg(k, { text: `${text.slice(0, at)}{${name}}${text.slice(at)}` });
  };

  async function save() {
    if (v.mode === "LIVE" && initial.mode !== "LIVE" && !confirm("تشغيل الإرسال للضيوف؟ تأكد أن القوالب معتمدة في Meta وأن الرسالة التجريبية وصلت.")) return;
    const r = await m.run("/api/admin/settings/whatsappAutomation", "PUT", {
      ...v,
      messages: Object.fromEntries(Object.entries(v.messages).map(([k, c]) => [k, { ...c, templateName: c.templateName?.trim() || null }])),
    });
    if (r) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    }
  }

  return (
    <Card title="إعدادات الرسائل التلقائية" className="mt-5">
      <fieldset>
        <legend className="text-sm font-medium">التشغيل</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(Object.keys(MODE) as Automation["mode"][]).map((mode) => (
            <label key={mode} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${v.mode === mode ? "border-jood-gold bg-jood-gold/10" : "border-jood-green/15"}`}>
              <input type="radio" name="mode" className="mt-1 accent-jood-green" checked={v.mode === mode} onChange={() => setV({ ...v, mode })} />
              {MODE[mode]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="التذكير قبل الدخول بـ (ساعة)"><input type="number" min={1} value={v.reminderHoursBefore} onChange={(e) => setV({ ...v, reminderHoursBefore: Number(e.target.value) })} className={inputClass} /></Field>
        <Field label="رمز الدخول قبل الدخول بـ (ساعة)"><input type="number" min={1} value={v.accessHoursBefore} onChange={(e) => setV({ ...v, accessHoursBefore: Number(e.target.value) })} className={inputClass} /></Field>
        <Field label="الشكر بعد الخروج بـ (ساعة)"><input type="number" min={0} value={v.thankYouHoursAfter} onChange={(e) => setV({ ...v, thankYouHoursAfter: Number(e.target.value) })} className={inputClass} /></Field>
      </div>
      <p className="mt-3 rounded-xl bg-jood-beige px-4 py-3 text-xs leading-6">
        رمز الدخول لا يُرسل إلا بعد اكتمال سداد مبلغ الحجز والتأمين واعتمادك لهما، وبعد التأكد أن رمز TTLock صالح لفترة الحجز نفسها. إن لم تكتمل الشروط تصل الضيفَ رسالة بالمبلغ المتبقي ويصلك تنبيه.
        كل رسالة تحتاج «قالبًا» معتمدًا من Meta بالنص نفسه؛ انسخ «نص القالب لـ Meta» عند إنشائه.
      </p>

      <div className="mt-5 space-y-5">
        {status.messages.map(({ kind, title, when, defaultText }) => {
          const c = v.messages[kind];
          return (
            <section key={kind} aria-label={title} className="rounded-xl border border-jood-green/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-semibold text-jood-green">{title}</h3>
                  <p className="text-xs text-jood-ink/60">{when}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-jood-green" checked={c.enabled} onChange={(e) => setMsg(kind, { enabled: e.target.checked })} />
                  مفعّلة
                </label>
              </div>
              <Field label="نص الرسالة" className="mt-3">
                <textarea ref={(el) => { areas.current[kind] = el; }} rows={4} value={c.text} onChange={(e) => setMsg(kind, { text: e.target.value })} className={inputClass} />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1" aria-label="المتغيرات">
                {Object.entries(status.variables).map(([name, label]) => (
                  <button key={name} type="button" title={label} onClick={() => insertVar(kind, name)} className="rounded-full bg-jood-gold/15 px-2 py-0.5 text-xs" dir="ltr">
                    {`{${name}}`}
                  </button>
                ))}
                {c.text !== defaultText && (
                  <button type="button" onClick={() => setMsg(kind, { text: defaultText })} className="rounded-full px-2 py-0.5 text-xs text-jood-green underline">استعادة النص الافتراضي</button>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_8rem]">
                <Field label="اسم القالب المعتمد في Meta" hint="بأحرف إنجليزية صغيرة و _ مثل jood_access">
                  <input dir="ltr" value={c.templateName ?? ""} onChange={(e) => setMsg(kind, { templateName: e.target.value })} className={`${inputClass} text-end`} />
                </Field>
                <Field label="لغة القالب"><input dir="ltr" value={c.language} onChange={(e) => setMsg(kind, { language: e.target.value })} className={`${inputClass} text-end`} /></Field>
              </div>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-jood-green">نص القالب لـ Meta</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-2 leading-6">{metaText(c.text)}</p>
              </details>
            </section>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button busy={m.busy} onClick={save}>حفظ</Button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ</span>}
      </div>
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

function metaText(text: string) {
  let n = 0;
  return text.replace(/\{([a-z_]+)\}/g, () => `{{${++n}}}`);
}

function TestCard({ status }: { status: Status }) {
  const [kind, setKind] = useState<Kind>("REQUEST_RECEIVED");
  const [to, setTo] = useState("");
  const m = useMutation();
  const [result, setResult] = useState<string | null>(null);
  return (
    <Card title="رسالة تجريبية" className="mt-5">
      <p className="-mt-2 mb-3 text-sm text-jood-ink/60">تُرسل الرسالة ببيانات حجز وهمية (رمز الدخول 000000) إلى الرقم الذي تكتبه — رقمك أنت. تحتاج ربط الحساب واسم القالب.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="الرسالة">
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputClass}>
            {status.messages.map((x) => <option key={x.kind} value={x.kind}>{x.title}</option>)}
          </select>
        </Field>
        <Field label="إلى رقم"><input dir="ltr" type="tel" placeholder="05xxxxxxxx" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} text-end`} /></Field>
        <Button busy={m.busy} disabled={!to.trim()} onClick={async () => { setResult(null); const r = await m.run<{ text: string }>("/api/admin/whatsapp/test", "POST", { kind, to }); if (r) setResult(r.text); }}>
          <Send className="size-4" /> إرسال
        </Button>
      </div>
      {result && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">أُرسلت: {result}</p>}
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
    </Card>
  );
}

function LogRow({ m, title, onChange }: { m: LogItem; title: string; onChange: () => void }) {
  const mut = useMutation();
  const s = STATUS_LABEL[m.status];
  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{title}</span>
          <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
          <div className="text-xs text-jood-ink/60">
            <Link to={`/admin/bookings/${m.booking.id}`} dir="ltr" className="text-jood-green underline">{m.booking.reference}</Link>
            {" · "}{m.booking.guest.name}
            {" · "}{m.sentAt ? `أُرسلت ${dateTime(m.sentAt)}` : `موعدها ${dateTime(m.scheduledAt)}`}
            {m.attempts > 1 && ` · محاولات: ${m.attempts}`}
          </div>
          {m.lastError && <div className="mt-1 text-xs text-red-800">السبب: {m.lastError}</div>}
        </div>
        {["FAILED", "BLOCKED", "SKIPPED", "DRY_RUN"].includes(m.status) && (
          <Button variant="secondary" busy={mut.busy} onClick={async () => { if (await mut.run(`/api/admin/whatsapp/messages/${m.id}/retry`, "POST", {})) onChange(); }}>
            <RotateCcw className="size-4" /> إعادة المحاولة
          </Button>
        )}
      </div>
      {m.preview && <p className="mt-2 rounded-lg bg-jood-beige/60 p-2 text-xs leading-6">{m.preview}</p>}
      <ErrorNote>{mut.error}</ErrorNote>
    </li>
  );
}

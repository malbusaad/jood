import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Share, Smartphone } from "lucide-react";
import { Button, Card, ErrorNote, useApi, useMutation } from "./ui";

interface PushInfo {
  enabled: boolean;
  publicKey: string | null;
  devices: { id: string; label: string | null; endpoint: string; service: string; createdAt: string; lastSuccessAt: string | null; lastError: string | null }[];
}

/** Adds the home-screen app definition and the service worker (admin pages only). */
export function useAdminApp() {
  useEffect(() => {
    if (!document.head.querySelector('link[rel="manifest"]')) {
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = "/admin.webmanifest";
      document.head.appendChild(link);
    }
    if (!document.head.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      for (const [name, content] of [["apple-mobile-web-app-capable", "yes"], ["apple-mobile-web-app-title", "إدارة الجود"]]) {
        const m = document.createElement("meta");
        m.name = name!;
        m.content = content!;
        document.head.appendChild(m);
      }
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "آيفون";
  if (/iPad/.test(ua)) return "آيباد";
  if (/Android/.test(ua)) return "أندرويد";
  return "كمبيوتر";
}

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** «إشعارات الجوال»: turn on notifications on this phone, test them, see registered devices. */
export function PushCard({ compact = false }: { compact?: boolean }) {
  const { data, reload } = useApi<PushInfo>("/api/admin/push");
  const m = useMutation();
  const [here, setHere] = useState<string | null | undefined>(undefined); // this device's endpoint
  const [msg, setMsg] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!supported()) return setHere(null);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setHere(sub?.endpoint ?? null);
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  if (!data || here === undefined) return null;
  const onHere = Boolean(here && data.devices.some((d) => d.endpoint === here));
  if (compact && onHere) return null;

  async function enable() {
    setMsg(null);
    m.setError(null);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return m.setError("لم يُسمح بالإشعارات. فعّلها من إعدادات الجهاز للموقع ثم حاول مرة أخرى.");
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data!.publicKey!) }));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    if (await m.run("/api/admin/push/subscriptions", "POST", { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() })) {
      setHere(json.endpoint);
      reload();
      setMsg("تم التفعيل. اضغط «إشعار تجريبي» للتأكد.");
    }
  }

  async function disable(id: string, endpoint: string) {
    if (endpoint === here) {
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      setHere(null);
    }
    if (await m.run(`/api/admin/push/subscriptions/${id}`, "DELETE")) reload();
  }

  let body;
  if (!data.enabled) {
    body = <p className="text-sm">الإشعارات غير مفعّلة على الخادم.</p>;
  } else if (isIOS() && !isStandalone()) {
    body = (
      <ol className="list-inside list-decimal space-y-1 text-sm leading-7">
        <li>اضغط زر المشاركة <Share aria-hidden className="inline size-4" /> أسفل Safari.</li>
        <li>اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».</li>
        <li>افتح «إدارة الجود» من الشاشة الرئيسية، وسجّل الدخول، ثم اضغط «تفعيل الإشعارات» هنا.</li>
      </ol>
    );
  } else if (!supported()) {
    body = <p className="text-sm">هذا المتصفح لا يدعم الإشعارات. استخدم Safari على الآيفون (iOS 16.4 أو أحدث) أو Chrome.</p>;
  } else if (onHere) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-emerald-700"><Bell aria-hidden className="me-1 inline size-4" />الإشعارات مفعّلة على هذا الجهاز.</span>
        <Button variant="secondary" busy={m.busy} onClick={async () => { const r = await m.run<{ sent: number; failed: number }>("/api/admin/push/test", "POST", {}); if (r) setMsg(r.sent ? "أُرسل إشعار تجريبي — يفترض أن يظهر خلال ثوانٍ." : "لم يُرسل الإشعار؛ أعد التفعيل."); }}>
          إشعار تجريبي
        </Button>
      </div>
    );
  } else {
    body = (
      <div>
        <p className="mb-3 text-sm leading-7">يصلك تنبيه على هذا الجهاز عند كل طلب حجز جديد، وعند عدم اكتمال السداد، وعند أي مشكلة في رمز الباب.</p>
        <Button busy={m.busy} onClick={enable}><Bell className="size-4" /> تفعيل الإشعارات على هذا الجهاز</Button>
      </div>
    );
  }

  return (
    <Card title="إشعارات الجوال" className={compact ? "mb-5 border border-jood-gold/40" : ""}>
      {body}
      {msg && <p className="mt-3 text-sm text-emerald-700">{msg}</p>}
      <div className="mt-3"><ErrorNote>{m.error}</ErrorNote></div>
      {!compact && data.devices.length > 0 && (
        <ul className="mt-4 divide-y divide-jood-green/10 text-sm" aria-label="الأجهزة المسجلة">
          {data.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Smartphone aria-hidden className="me-1 inline size-4" />
                {d.label ?? d.service}
                {d.endpoint === here && <span className="ms-2 text-xs text-emerald-700">(هذا الجهاز)</span>}
                {d.lastError && <span className="ms-2 text-xs text-red-800">آخر خطأ: {d.lastError}</span>}
              </span>
              <Button variant="ghost" onClick={() => disable(d.id, d.endpoint)}><BellOff className="size-4" /> إيقاف</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

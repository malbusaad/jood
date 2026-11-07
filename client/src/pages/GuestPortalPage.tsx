import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { CalendarDays, Check, KeyRound, LogOut, MapPin, MessageCircle, Phone, Wifi } from "lucide-react";
import { api, ApiError } from "../api/client";
import Pattern from "../components/Pattern";
import CopyButton from "../components/CopyButton";
import { formatDateAr, formatSAR, formatTimeAr } from "../lib/format";

interface Portal {
  siteName: string;
  guestName: string;
  reference: string;
  startDate: string;
  endDate: string;
  checkIn: string;
  checkOut: string;
  items: string[];
  houseRules: string[];
  departureInstructions: string[];
  contact: { phone: string | null; whatsapp: string | null; email: string | null; mapUrl: string | null };
  location: { district: string; city: string; country: string };
  codes: { entryCode: string | null; wifiName: string | null; wifiPassword: string | null } | null;
  codesAvailableOn: string | null;
  /** Money still owed: codes stay hidden until it is paid and verified. */
  paymentPending?: { bookingRemaining: number; depositRemaining: number; dueBy: string | null } | null;
}

function Section({ title, Icon, children }: { title: string; Icon: typeof KeyRound; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white/90 p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-jood-green">
        <Icon aria-hidden className="size-5 text-jood-gold" strokeWidth={1.5} /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The guest's private page, opened from the link the owner sends on WhatsApp after confirmation. */
export default function GuestPortalPage() {
  const { token } = useParams();
  const [portal, setPortal] = useState<Portal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "حجزك | استراحة الجود";
    // Keep the private link out of search engines and referrers.
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    api<Portal>(`/api/guest/${encodeURIComponent(token ?? "")}`)
      .then(setPortal)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذر الاتصال، حاول مرة أخرى"));
    return () => meta.remove();
  }, [token]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-jood-green-950 px-6 text-center text-jood-beige">
        <div>
          <p className="font-display text-2xl">استراحة الجود</p>
          <p className="mt-4 leading-8 text-jood-beige/80" role="alert">{error}</p>
        </div>
      </div>
    );
  }
  if (!portal) return <div className="min-h-dvh bg-jood-green-950" aria-busy="true" aria-label="جارٍ التحميل" />;

  const p = portal;
  const firstName = p.guestName.split(" ")[0];
  const wa = p.contact.whatsapp ?? p.contact.phone;
  const hasCodes = p.codes && (p.codes.entryCode || p.codes.wifiName || p.codes.wifiPassword);

  return (
    <div className="min-h-dvh bg-jood-beige pb-10">
      <header className="relative isolate overflow-hidden bg-jood-green-950 px-5 pt-10 pb-16 text-jood-beige">
        <Pattern className="-z-10 text-jood-gold" opacity={0.08} />
        <p className="text-sm tracking-[0.25em] text-jood-gold">{p.siteName}</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">أهلًا {firstName}</h1>
        <p className="mt-2 text-jood-beige/75">حجزك مؤكد، ويسعدنا استقبالك.</p>
        <p className="mt-4 text-sm text-jood-beige/60">رقم الحجز <span dir="ltr" className="font-display text-jood-beige">{p.reference}</span></p>
      </header>

      <main className="relative z-10 mx-auto -mt-8 max-w-lg space-y-4 px-4">
        <Section title="موعد الإقامة" Icon={CalendarDays}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-jood-beige p-3">
              <dt className="text-jood-ink/55">الدخول</dt>
              <dd className="mt-1 font-medium">{formatDateAr(p.startDate)}</dd>
              <dd className="font-display text-lg text-jood-green">{formatTimeAr(p.checkIn)}</dd>
            </div>
            <div className="rounded-2xl bg-jood-beige p-3">
              <dt className="text-jood-ink/55">الخروج</dt>
              <dd className="mt-1 font-medium">{formatDateAr(p.endDate)}</dd>
              <dd className="font-display text-lg text-jood-green">{formatTimeAr(p.checkOut)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-jood-ink/70">المحجوز: {p.items.join("، ")}</p>
        </Section>

        <Section title="الدخول والواي فاي" Icon={KeyRound}>
          {p.codes === null && p.paymentPending ? (
            <div className="text-sm leading-7 text-jood-ink/75">
              <p>يظهر رمز الدخول وبيانات الواي فاي هنا بعد اكتمال السداد والتحقق منه:</p>
              <ul className="mt-2 list-inside list-disc">
                {p.paymentPending.bookingRemaining > 0 && <li>المتبقي من مبلغ الحجز: {formatSAR(p.paymentPending.bookingRemaining)}</li>}
                {p.paymentPending.depositRemaining > 0 && <li>مبلغ التأمين (يُسترد بعد المغادرة): {formatSAR(p.paymentPending.depositRemaining)}</li>}
              </ul>
              <p className="mt-2">تواصل معنا عبر واتساب بعد التحويل.</p>
            </div>
          ) : p.codes === null ? (
            <p className="text-sm leading-7 text-jood-ink/75">يظهر رمز الدخول وبيانات الواي فاي هنا يوم وصولك، {formatDateAr(p.codesAvailableOn!)}.</p>
          ) : !hasCodes ? (
            <p className="text-sm leading-7 text-jood-ink/75">سنرسل لك تفاصيل الدخول قبل موعدك.</p>
          ) : (
            <dl className="space-y-3">
              {p.codes.entryCode && (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-jood-green p-4 text-jood-beige">
                  <div>
                    <dt className="text-xs text-jood-beige/70">رمز الدخول</dt>
                    <dd dir="ltr" className="font-display text-3xl tracking-[0.2em] text-jood-gold">{p.codes.entryCode}</dd>
                  </div>
                </div>
              )}
              {(p.codes.wifiName || p.codes.wifiPassword) && (
                <div className="rounded-2xl bg-jood-beige p-4 text-sm">
                  <div className="flex items-center gap-2 text-jood-ink/60"><Wifi aria-hidden className="size-4" /> الواي فاي</div>
                  {p.codes.wifiName && <div className="mt-2 flex justify-between gap-2"><dt>الشبكة</dt><dd dir="ltr" className="font-medium">{p.codes.wifiName}</dd></div>}
                  {p.codes.wifiPassword && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <dt>كلمة المرور</dt>
                      <dd className="flex items-center gap-2"><span dir="ltr" className="font-mono">{p.codes.wifiPassword}</span><CopyButton value={p.codes.wifiPassword} /></dd>
                    </div>
                  )}
                </div>
              )}
            </dl>
          )}
        </Section>

        <Section title="تعليمات الاستراحة" Icon={Check}>
          <ul className="space-y-2 text-sm leading-7">
            {p.houseRules.map((r) => (
              <li key={r} className="flex gap-2"><Check aria-hidden className="mt-1.5 size-3.5 shrink-0 text-jood-gold" />{r}</li>
            ))}
          </ul>
        </Section>

        {p.departureInstructions.length > 0 && (
          <Section title="عند المغادرة" Icon={LogOut}>
            <ul className="space-y-2 text-sm leading-7">
              {p.departureInstructions.map((r) => (
                <li key={r} className="flex gap-2"><Check aria-hidden className="mt-1.5 size-3.5 shrink-0 text-jood-gold" />{r}</li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="التواصل" Icon={Phone}>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><MapPin aria-hidden className="size-4 text-jood-gold" />{p.location.district}، {p.location.city}</p>
            {p.contact.mapUrl && <a href={p.contact.mapUrl} target="_blank" rel="noopener noreferrer" className="block text-jood-green underline">الموقع على الخريطة</a>}
            {wa && (
              <a href={`https://wa.me/${wa.replace(/\D/g, "")}?text=${encodeURIComponent(`مرحبًا، بخصوص حجزي رقم ${p.reference}`)}`} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-full bg-[#1f7a4d] px-5 py-3 text-white">
                <MessageCircle aria-hidden className="size-4" /> تواصل معنا عبر واتساب
              </a>
            )}
            {p.contact.phone && <a href={`tel:+${p.contact.phone}`} className="flex items-center justify-center gap-2 rounded-full border border-jood-green/25 px-5 py-3 text-jood-green"><Phone aria-hidden className="size-4" /> اتصال</a>}
          </div>
        </Section>

        <p className="pt-2 text-center text-xs text-jood-ink/50">هذا الرابط خاص بحجزك، فلا تشاركه مع غيرك.</p>
      </main>
    </div>
  );
}

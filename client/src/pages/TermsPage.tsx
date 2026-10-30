import { Check } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SectionHeading from "../components/SectionHeading";
import PendingNotice from "../components/PendingNotice";
import { useSiteContent } from "../hooks/useSiteContent";
import { formatTimeAr } from "../lib/format";

export default function TermsPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="الشروط والتعليمات">نرجو قراءة التعليمات التالية قبل الحجز، حرصًا على راحة الجميع.</PageHeader>
      <section className="mx-auto max-w-4xl space-y-16 px-4 py-16">
        <div>
          <SectionHeading title="أوقات الدخول والخروج" />
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/80 p-6">
              <dt className="text-sm text-jood-ink/60">الدخول</dt>
              <dd className="mt-1 font-display text-2xl text-jood-green">{formatTimeAr(site.stay.checkIn)}</dd>
            </div>
            <div className="rounded-2xl bg-white/80 p-6">
              <dt className="text-sm text-jood-ink/60">الخروج</dt>
              <dd className="mt-1 font-display text-2xl text-jood-green">{formatTimeAr(site.stay.checkOut)}</dd>
              <dd className="mt-1 text-xs text-jood-ink/60">من اليوم التالي</dd>
            </div>
          </dl>
        </div>

        <div>
          <SectionHeading title="تعليمات الاستراحة" />
          <ul className="mt-8 grid gap-3">
            {site.houseRules.map((r) => (
              <li key={r} className="flex items-start gap-3 rounded-2xl bg-white/70 px-5 py-4 leading-7">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-jood-gold" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SectionHeading title="الحجز والدفع" />
          <ul className="mt-8 list-disc space-y-3 ps-5 leading-8">
            <li>إرسال طلب الحجز لا يعني تأكيده.</li>
            <li>لا يتأكد الحجز إلا بعد تحقق المالك من وصول مبلغ التحويل فعليًا، ورفع إثبات التحويل وحده لا يكفي.</li>
            <li>تظهر بيانات التحويل البنكي بعد إرسال طلب الحجز، ولا تُنشر في الصفحات العامة.</li>
            <li>الحجز عبر منصة جاذر إن يخضع لشروط المنصة، وقد تُطبق عليه رسوم إضافية منها.</li>
          </ul>
        </div>

        <div>
          <SectionHeading title="الإلغاء والاسترداد" />
          {site.cancellationPolicy.text ? (
            <p className="mt-8 whitespace-pre-line leading-8">{site.cancellationPolicy.text}</p>
          ) : (
            <PendingNotice className="mt-8">سياسة الإلغاء والاسترداد يحددها المالك وستُضاف هنا.</PendingNotice>
          )}
        </div>
      </section>
    </>
  );
}

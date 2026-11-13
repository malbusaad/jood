import { lazy, Suspense } from "react";
import { Landmark } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SectionHeading from "../components/SectionHeading";
import GathernCard from "../components/GathernCard";
import PricingCards from "../components/PricingCards";
import { useSiteContent } from "../hooks/useSiteContent";

const BookingForm = lazy(() => import("../components/BookingForm"));

const steps = [
  "اختر التاريخ وعدد الأيام.",
  "اختر الاستراحة كاملة أو الأجزاء المتاحة.",
  "راجع السعر النهائي وتفاصيله.",
  "أدخل بياناتك وأرسل الطلب، واحصل على رقم الطلب.",
  "يتواصل معك المالك عبر واتساب لتأكيد التفاصيل وإرسال العقد.",
  "حوّل المبلغ، ويتأكد الحجز بعد تحقق المالك من وصوله.",
];

export default function BookingPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="الأسعار والحجز">اختر يومك وشاهد سعره مباشرة، واحجز الاستراحة كاملة أو أجزاء منها حسب الإتاحة.</PageHeader>
      <section className="mx-auto max-w-6xl px-4 pt-8">
        <PricingCards weekdayPrices={site.weekdayPrices} compact />
        <p className="mt-2 text-xs text-jood-ink/60">لحجز الاستراحة كاملة لليوم. سعر كل يوم ظاهر تحته في التقويم، وقد يختلف في المواسم والمناسبات.</p>
      </section>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-6 pb-12 lg:grid-cols-[1fr_22rem]">
        <Suspense fallback={<div className="h-96 rounded-3xl border border-jood-green/10 bg-white/60" aria-busy="true" />}>
          <BookingForm />
        </Suspense>

        <aside className="space-y-8">
          <div>
            <SectionHeading title="خطوات الحجز" />
            <ol className="mt-6 space-y-3">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-3 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-jood-green font-display text-xs text-jood-gold">{i + 1}</span>
                  <span className="pt-1 leading-6">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <details className="rounded-3xl border border-jood-green/15 bg-white/80 p-6">
            <summary className="cursor-pointer font-display text-lg font-semibold text-jood-green">ملاحظات على الأسعار</summary>
            <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-7 text-jood-ink/75">
              <li>الأسعار أعلاه لحجز الاستراحة كاملة لليوم، وسعر كل يوم ظاهر تحته في التقويم.</li>
              <li>قد تختلف الأسعار في المواسم والإجازات والتواريخ الخاصة.</li>
              <li>يمكن حجز بعض أجزاء الاستراحة بصورة مستقلة، بأسعار تظهر عند اختيارها.</li>
              <li>يظهر لك السعر النهائي وتفصيله بوضوح قبل إرسال طلب الحجز.</li>
              <li>الحجز عبر منصة جاذر إن قد تُطبق عليه رسوم إضافية من المنصة.</li>
            </ul>
          </details>
          <div className="rounded-3xl border border-jood-green/15 bg-white/80 p-6">
            <Landmark aria-hidden className="size-6 text-jood-gold" strokeWidth={1.25} />
            <h3 className="mt-3 font-display text-xl font-semibold text-jood-green">التحويل البنكي</h3>
            <p className="mt-2 text-sm leading-7 text-jood-ink/75">
              تظهر لك بيانات التحويل بعد إرسال طلب الحجز. يتحقق المالك من وصول المبلغ يدويًا، ثم يتأكد الحجز.
            </p>
          </div>
          <GathernCard gathern={site.gathern} />
        </aside>
      </section>
    </>
  );
}

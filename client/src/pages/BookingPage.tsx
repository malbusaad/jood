import { lazy, Suspense } from "react";
import { Landmark } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SectionHeading from "../components/SectionHeading";
import GathernCard from "../components/GathernCard";
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
      <PageHeader title="الحجز">احجز الاستراحة كاملة أو أجزاء منها حسب الإتاحة.</PageHeader>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1fr_22rem]">
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

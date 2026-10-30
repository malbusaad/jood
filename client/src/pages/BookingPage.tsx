import { Landmark } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SectionHeading from "../components/SectionHeading";
import PendingNotice from "../components/PendingNotice";
import GathernCard from "../components/GathernCard";
import PriceCalendar from "../components/LazyPriceCalendar";
import { useSiteContent } from "../hooks/useSiteContent";

const steps = [
  "اختر التاريخ.",
  "اختر الاستراحة كاملة أو الأجزاء المتاحة.",
  "راجع السعر النهائي وتفاصيله.",
  "أدخل بياناتك واختر طريقة الدفع.",
  "أرسل الطلب واحصل على رقم الطلب.",
  "يتواصل معك المالك عبر واتساب لتأكيد التفاصيل وإرسال العقد.",
  "حوّل المبلغ، ويتأكد الحجز بعد تحقق المالك من وصوله.",
];

export default function BookingPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="الحجز">احجز الاستراحة كاملة أو أجزاء منها حسب الإتاحة.</PageHeader>
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-16">
        <PendingNotice>
          استقبال طلبات الحجز عبر الموقع قيد التفعيل. يمكنك حاليًا الاطلاع على الأسعار وخطوات الحجز.
        </PendingNotice>

        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading title="خطوات الحجز" />
            <ol className="mt-8 space-y-4">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-jood-green font-display text-sm text-jood-gold">
                    {i + 1}
                  </span>
                  <span className="pt-1 leading-7">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <PriceCalendar />
        </div>

        <div>
          <SectionHeading title="طرق الدفع" />
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-jood-green/15 bg-white/80 p-6 sm:p-8">
              <Landmark aria-hidden className="size-7 text-jood-gold" strokeWidth={1.25} />
              <h3 className="mt-4 font-display text-2xl font-semibold text-jood-green">التحويل البنكي</h3>
              <p className="mt-3 leading-8 text-jood-ink/75">
                تظهر لك بيانات التحويل بعد إرسال طلب الحجز. بعد التحويل يتحقق المالك من وصول المبلغ يدويًا، ثم يتأكد
                الحجز ويصلك رابطك الخاص.
              </p>
            </div>
            <GathernCard gathern={site.gathern} />
          </div>
        </div>
      </section>
    </>
  );
}

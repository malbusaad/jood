import { Link } from "react-router";
import PageHeader from "../components/PageHeader";
import PricingCards from "../components/PricingCards";
import PriceCalendar from "../components/LazyPriceCalendar";
import SectionHeading from "../components/SectionHeading";
import { useSiteContent } from "../hooks/useSiteContent";

export default function PricingPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="الأسعار">أسعار حجز الاستراحة كاملة لليوم بالريال السعودي.</PageHeader>
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-16">
        <PricingCards weekdayPrices={site.weekdayPrices} />

        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading title="ملاحظات على الأسعار">
              <ul className="list-disc space-y-2 ps-5">
                <li>الأسعار أعلاه لحجز الاستراحة كاملة.</li>
                <li>قد تختلف الأسعار في المواسم والإجازات والتواريخ الخاصة.</li>
                <li>
                  يمكن حجز بعض أجزاء الاستراحة بصورة مستقلة، بأسعار يحددها المالك لكل جزء وتظهر عند الحجز.
                </li>
                <li>يظهر لك السعر النهائي وتفصيله بوضوح قبل إرسال طلب الحجز.</li>
                <li>الحجز عبر منصة جاذر إن قد تُطبق عليه رسوم إضافية من المنصة.</li>
              </ul>
            </SectionHeading>
            <Link
              to="/booking"
              className="mt-8 inline-block rounded-full bg-jood-green px-8 py-3.5 text-jood-beige transition hover:bg-jood-green-800"
            >
              احجز الآن
            </Link>
          </div>
          <PriceCalendar />
        </div>
      </section>
    </>
  );
}

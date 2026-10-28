import PageHeader from "../components/PageHeader";
import FaqList from "../components/FaqList";
import { useSiteContent } from "../hooks/useSiteContent";

export default function FaqPage() {
  const { faqs } = useSiteContent();
  return (
    <>
      <PageHeader title="الأسئلة الشائعة">إجابات عن أكثر الأسئلة تكرارًا حول الحجز والاستراحة.</PageHeader>
      <section className="mx-auto max-w-3xl px-4 py-16">
        <FaqList faqs={faqs} />
      </section>
    </>
  );
}

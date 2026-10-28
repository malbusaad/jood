import PageHeader from "../components/PageHeader";
import ContactDetails from "../components/ContactDetails";
import MediaPlaceholder from "../components/MediaPlaceholder";
import { useSiteContent } from "../hooks/useSiteContent";

export default function ContactPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="تواصل معنا">لأي استفسار عن الحجز أو المرافق، يسعدنا تواصلكم.</PageHeader>
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 lg:grid-cols-2">
        <ContactDetails site={site} />
        <MediaPlaceholder label="خريطة الموقع قريبًا" className="aspect-[4/3]" />
      </section>
    </>
  );
}

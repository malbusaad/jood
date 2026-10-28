import PageHeader from "../components/PageHeader";
import AmenityGrid from "../components/AmenityGrid";
import { useSiteContent } from "../hooks/useSiteContent";

export default function AmenitiesPage() {
  const site = useSiteContent();
  return (
    <>
      <PageHeader title="المرافق">
        تعرّف على مرافق استراحة الجود وسعة كل منها. قد تتغير إتاحة بعض المرافق حسب الموسم.
      </PageHeader>
      <section className="mx-auto max-w-6xl px-4 py-16">
        <AmenityGrid amenities={site.amenities} />
      </section>
    </>
  );
}

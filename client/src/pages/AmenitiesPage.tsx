import { Link } from "react-router";
import { Images } from "lucide-react";
import PageHeader from "../components/PageHeader";
import AmenityGrid from "../components/AmenityGrid";
import { useSiteContent } from "../hooks/useSiteContent";

export default function AmenitiesPage() {
  const site = useSiteContent();
  const facilities = site.amenities.filter((a) => a.category !== "SERVICE");
  const services = site.amenities.filter((a) => a.category === "SERVICE");
  const photoCounts = site.media.gallery.reduce<Record<string, number>>((acc, g) => {
    if (g.amenityId) acc[g.amenityId] = (acc[g.amenityId] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <>
      <PageHeader title="المرافق والخدمات">مرافق متعددة وخدمات تجعل إقامتك استثنائية ومميزة.</PageHeader>
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-16">
        <div>
          <h2 className="font-display text-2xl font-semibold text-jood-green sm:text-3xl">المرافق</h2>
          <div className="mt-6">
            <AmenityGrid amenities={facilities} photoCounts={photoCounts} />
          </div>
        </div>
        {services.length > 0 && (
          <div>
            <h2 className="font-display text-2xl font-semibold text-jood-green sm:text-3xl">الخدمات</h2>
            <div className="mt-6">
              <AmenityGrid amenities={services} photoCounts={photoCounts} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-3xl bg-jood-green-950 px-6 py-10 text-center text-jood-beige">
          <p className="w-full font-display text-2xl">شاهد الاستراحة قبل أن تحجز</p>
          <Link to="/gallery" className="inline-flex items-center gap-2 rounded-full border border-jood-gold/60 px-6 py-3 transition hover:bg-white/5">
            <Images aria-hidden className="size-4" /> معرض الصور
          </Link>
          <Link to="/booking" className="rounded-full bg-jood-gold px-8 py-3 font-medium text-jood-green-950 transition hover:bg-jood-gold-light">
            احجز الآن
          </Link>
        </div>
      </section>
    </>
  );
}

import { Link, useSearchParams } from "react-router";
import PageHeader from "../components/PageHeader";
import GalleryGrid from "../components/GalleryGrid";
import PendingNotice from "../components/PendingNotice";
import { useSiteContent } from "../hooks/useSiteContent";

export default function GalleryPage() {
  const { media, amenities } = useSiteContent();
  const [params] = useSearchParams();
  const selected = params.get("amenity");
  // Only amenities that have photos get a filter chip.
  const withPhotos = amenities.filter((a) => media.gallery.some((g) => g.amenityId === a.id));
  const images = selected ? media.gallery.filter((g) => g.amenityId === selected) : media.gallery;
  const chip = (active: boolean) => `rounded-full px-4 py-1.5 text-sm transition ${active ? "bg-jood-green text-jood-beige" : "bg-white text-jood-ink/75 hover:bg-jood-gold/15"}`;
  return (
    <>
      <PageHeader title="معرض الصور">صور الاستراحة ومرافقها.</PageHeader>
      <section className="mx-auto max-w-6xl space-y-8 px-4 py-16">
        {media.gallery.length === 0 && <PendingNotice>صور الاستراحة الحقيقية قيد الإضافة وستظهر هنا قريبًا.</PendingNotice>}
        {withPhotos.length > 0 && (
          <nav aria-label="تصفية الصور حسب المرفق" className="flex flex-wrap gap-2">
            <Link to="/gallery" className={chip(!selected)} aria-current={!selected ? "page" : undefined}>الكل</Link>
            {withPhotos.map((a) => (
              <Link key={a.id} to={`/gallery?amenity=${a.id}`} className={chip(selected === a.id)} aria-current={selected === a.id ? "page" : undefined}>
                {a.name}
              </Link>
            ))}
          </nav>
        )}
        <GalleryGrid images={images} placeholders={6} />
        <div className="text-center">
          <Link to="/booking" className="inline-block rounded-full bg-jood-gold px-8 py-3.5 font-medium text-jood-green-950 transition hover:bg-jood-gold-light">احجز الآن</Link>
        </div>
      </section>
    </>
  );
}

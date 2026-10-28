import PageHeader from "../components/PageHeader";
import GalleryGrid from "../components/GalleryGrid";
import PendingNotice from "../components/PendingNotice";
import { useSiteContent } from "../hooks/useSiteContent";

export default function GalleryPage() {
  const { media } = useSiteContent();
  return (
    <>
      <PageHeader title="معرض الصور">صور الاستراحة ومرافقها.</PageHeader>
      <section className="mx-auto max-w-6xl space-y-8 px-4 py-16">
        {media.gallery.length === 0 && <PendingNotice>صور الاستراحة الحقيقية قيد الإضافة وستظهر هنا قريبًا.</PendingNotice>}
        <GalleryGrid images={media.gallery} placeholders={6} />
      </section>
    </>
  );
}

import PageHeader from "../components/PageHeader";
import VideoBlock from "../components/VideoBlock";
import { useSiteContent } from "../hooks/useSiteContent";

export default function VideoPage() {
  const { media } = useSiteContent();
  return (
    <>
      <PageHeader title="الفيديو التعريفي">جولة مرئية في استراحة الجود.</PageHeader>
      <section className="mx-auto max-w-5xl px-4 py-16">
        <VideoBlock url={media.videoUrl} poster={media.heroImageUrl} />
      </section>
    </>
  );
}

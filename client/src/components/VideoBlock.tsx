import { Play } from "lucide-react";
import Pattern from "./Pattern";

export default function VideoBlock({ url, poster, video }: { url: string | null; poster?: string | null; video?: { kind: "iframe" | "file"; src: string } | null }) {
  if (video?.kind === "iframe") {
    return (
      <iframe
        className="aspect-video w-full rounded-3xl bg-jood-green-950"
        src={video.src}
        title="الفيديو التعريفي لاستراحة الجود"
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  if (video?.kind === "file") url = video.src;
  if (url) {
    return (
      <video
        className="aspect-video w-full rounded-3xl bg-jood-green-950 object-cover"
        src={url}
        poster={poster ?? undefined}
        controls
        preload="none"
        playsInline
      />
    );
  }
  return (
    <div
      role="img"
      aria-label="الفيديو التعريفي قريبًا"
      className="relative isolate grid aspect-video w-full place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-jood-green-800 to-jood-green-950"
    >
      <Pattern className="text-jood-gold" opacity={0.1} />
      <div className="flex flex-col items-center gap-4 text-jood-beige/70">
        <span className="grid size-16 place-items-center rounded-full border border-jood-gold/50 text-jood-gold">
          <Play aria-hidden className="size-6" strokeWidth={1.25} />
        </span>
        <span className="text-sm">الفيديو التعريفي قريبًا</span>
      </div>
    </div>
  );
}

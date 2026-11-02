import MediaPlaceholder from "./MediaPlaceholder";
import type { GalleryImage } from "../content/types";

/** شبكة الصور. عند عدم وجود صور مرفوعة تُعرض أماكن مخصصة لها. */
export default function GalleryGrid({ images, placeholders = 6 }: { images: GalleryImage[]; placeholders?: number }) {
  const spans = ["sm:col-span-2 sm:row-span-2", "", "", "", "sm:col-span-2", ""];
  if (images.length === 0) {
    return (
      <div className="grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[200px] sm:grid-cols-4">
        {Array.from({ length: placeholders }, (_, i) => (
          <MediaPlaceholder key={i} className={`size-full ${spans[i % spans.length]}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[200px] sm:grid-cols-4">
      {images.map((img, i) => (
        <img
          key={img.url}
          src={img.url}
          alt={img.alt}
          loading={i < 2 ? "eager" : "lazy"}
          decoding="async"
          className={`size-full rounded-2xl object-cover ${spans[i % spans.length]}`}
        />
      ))}
    </div>
  );
}

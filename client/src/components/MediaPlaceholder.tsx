import { ImageIcon } from "lucide-react";
import Pattern from "./Pattern";

/** مكان صورة لم تُرفع بعد. لا نعرض صورًا لا تخص الاستراحة. */
export default function MediaPlaceholder({
  label = "صورة الاستراحة قريبًا",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative isolate grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-jood-green-800 to-jood-green-950 text-jood-gold ${className}`}
    >
      <Pattern opacity={0.12} />
      <span className="flex flex-col items-center gap-2 text-xs text-jood-beige/60">
        <ImageIcon aria-hidden className="size-6 text-jood-gold/70" strokeWidth={1.25} />
        {label}
      </span>
    </div>
  );
}

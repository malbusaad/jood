import { useId } from "react";

/** نقش هندسي خفيف (نجمة ثمانية) يُستخدم خلفيةً للأقسام الداكنة وأماكن الصور. */
export default function Pattern({ className = "", opacity = 0.08 }: { className?: string; opacity?: number }) {
  const id = useId();
  return (
    <svg aria-hidden className={`pointer-events-none absolute inset-0 size-full ${className}`}>
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="0.8">
            <rect x="16" y="16" width="24" height="24" />
            <rect x="16" y="16" width="24" height="24" transform="rotate(45 28 28)" />
            <circle cx="28" cy="28" r="4" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

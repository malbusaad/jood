import type { ReactNode } from "react";

export default function SectionHeading({
  eyebrow,
  title,
  children,
  tone = "light",
  center = false,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  tone?: "light" | "dark";
  center?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <div className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <p className="text-sm tracking-[0.2em] text-jood-gold">{eyebrow}</p>}
      <h2 className={`mt-2 text-3xl font-semibold sm:text-4xl ${dark ? "text-jood-beige" : "text-jood-green"}`}>
        {title}
      </h2>
      <span aria-hidden className={`mt-4 block h-px w-16 bg-jood-gold ${center ? "mx-auto" : ""}`} />
      {children && (
        <div className={`mt-4 leading-8 ${dark ? "text-jood-beige/75" : "text-jood-ink/70"}`}>{children}</div>
      )}
    </div>
  );
}

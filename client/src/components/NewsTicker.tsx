import { useEffect, useState, type CSSProperties } from "react";
import type { SiteContent } from "../content/types";

/**
 * Slim moving news bar above the header. Phrases, order, speed and direction come from the admin
 * settings. Pauses on hover/focus; on small screens it can show one phrase at a time instead, and
 * it never moves for visitors who ask for reduced motion.
 */
export default function NewsTicker({ ticker }: { ticker: SiteContent["ticker"] }) {
  const items = ticker.enabled ? ticker.items.filter((i) => i.active) : [];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), ticker.secondsPerItem * 1000);
    return () => clearInterval(t);
  }, [items.length, ticker.secondsPerItem]);

  if (items.length === 0) return null;

  // Repeat the phrases so the strip is always wider than the screen, then run two copies for a seamless loop.
  const reps = Math.max(1, Math.ceil(6 / items.length));
  const run = Array.from({ length: reps }, () => items).flat();
  const style = {
    "--ticker-duration": `${ticker.secondsPerItem * run.length}s`,
    // «rtl» = the strip travels toward the right, so each new phrase enters from the left (natural for Arabic).
    "--ticker-name": ticker.direction === "rtl" ? "jood-ticker-right" : "jood-ticker-left",
  } as CSSProperties;

  const strip = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {run.map((item, i) => (
        <li key={`${item.id}-${i}`} dir="rtl" className="flex items-center whitespace-nowrap">
          <span className="px-6">{item.text}</span>
          <span aria-hidden className="text-jood-gold/70">✦</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      aria-label="أخبار الاستراحة"
      data-mobile={ticker.mobile}
      className="jood-ticker relative overflow-hidden border-b border-jood-gold/20 bg-jood-green text-sm text-jood-beige"
    >
      <div className="jood-ticker-marquee py-2" dir="ltr">
        <div className="jood-ticker-track flex w-max" style={style}>
          {strip(false)}
          {strip(true)}
        </div>
      </div>
      <p className="jood-ticker-static px-4 py-2 text-center" aria-live="off">
        {items[index % items.length]!.text}
      </p>
    </section>
  );
}

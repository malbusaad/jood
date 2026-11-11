import { Link } from "react-router";
import { Images, Users } from "lucide-react";
import AmenityIcon from "./AmenityIcon";
import Reveal from "./Reveal";
import type { Amenity } from "../content/types";

/** `photoCounts`: how many gallery photos each amenity has — a link to them is shown when there are some. */
export default function AmenityGrid({ amenities, photoCounts }: { amenities: Amenity[]; photoCounts?: Record<string, number> }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {amenities.map((a, i) => (
        <li key={a.id}>
          <Reveal delay={(i % 3) * 80} className="h-full">
            <div className="group flex h-full items-start gap-4 rounded-2xl border border-jood-green/10 bg-white/70 p-5 transition hover:-translate-y-0.5 hover:border-jood-gold/50 hover:shadow-lg hover:shadow-jood-green/5">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-jood-green text-jood-gold transition group-hover:bg-jood-green-800">
                <AmenityIcon name={a.icon} className="size-6" />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-jood-green">{a.name}</h3>
                {a.capacityText && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-jood-ink/70">
                    <Users aria-hidden className="size-4 text-jood-gold" />
                    السعة: {a.capacityText}
                  </p>
                )}
                {a.note && <p className="mt-1 text-sm text-jood-ink/70">{a.note}</p>}
                {photoCounts?.[a.id] ? (
                  <Link to={`/gallery?amenity=${a.id}`} className="mt-2 inline-flex items-center gap-1 text-sm text-jood-green underline decoration-jood-gold underline-offset-4">
                    <Images aria-hidden className="size-4" /> الصور ({photoCounts[a.id]})
                  </Link>
                ) : null}
                {!a.available && (
                  <p className="mt-2 inline-block rounded-full bg-jood-ink/5 px-3 py-0.5 text-xs text-jood-ink/60">غير متاح حاليًا</p>
                )}
              </div>
            </div>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

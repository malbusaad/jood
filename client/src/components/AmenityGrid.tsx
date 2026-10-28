import { Users } from "lucide-react";
import AmenityIcon from "./AmenityIcon";
import Reveal from "./Reveal";
import type { Amenity } from "../content/site";

export default function AmenityGrid({ amenities }: { amenities: Amenity[] }) {
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
                {a.capacity && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-jood-ink/70">
                    <Users aria-hidden className="size-4 text-jood-gold" />
                    السعة: {a.capacity}
                  </p>
                )}
                {a.note && <p className="mt-1 text-sm text-jood-ink/70">{a.note}</p>}
              </div>
            </div>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

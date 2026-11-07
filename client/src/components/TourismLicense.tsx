import { BadgeCheck } from "lucide-react";
import type { SiteContent } from "../content/types";

/** «مرخصة من وزارة السياحة» band. Shown only when the owner enabled it with the real licence number. */
export default function TourismLicense({ license }: { license: SiteContent["tourismLicense"] }) {
  if (!license.enabled || !license.licenseNumber) return null;
  return (
    <section aria-label="الترخيص" className="border-b border-jood-gold/15 bg-jood-beige">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 py-3 text-jood-green-950">
        {license.logoUrl ? (
          <img src={license.logoUrl} alt="شعار وزارة السياحة" className="h-10 w-auto object-contain" />
        ) : (
          <BadgeCheck aria-hidden className="size-6 text-jood-gold" strokeWidth={1.5} />
        )}
        <p className="font-display text-base">{license.text}</p>
        <p className="text-sm text-jood-ink/70">
          رقم الترخيص: <span dir="ltr" className="font-medium text-jood-green-950">{license.licenseNumber}</span>
        </p>
      </div>
    </section>
  );
}

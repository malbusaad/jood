import { ChevronDown } from "lucide-react";
import type { Faq } from "../content/site";

export default function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <div className="divide-y divide-jood-green/10 rounded-3xl border border-jood-green/10 bg-white/80">
      {faqs.map((f) => (
        <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold text-jood-green">
            {f.q}
            <ChevronDown aria-hidden className="size-5 shrink-0 text-jood-gold transition group-open:rotate-180" />
          </summary>
          <p className="mt-3 leading-8 text-jood-ink/75">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

import { ExternalLink } from "lucide-react";
import PendingNotice from "./PendingNotice";
import type { SiteContent } from "../content/types";

export default function GathernCard({ gathern }: { gathern: SiteContent["gathern"] }) {
  return (
    <div className="rounded-3xl border border-jood-green/15 bg-white/80 p-6 sm:p-8">
      <h3 className="font-display text-2xl font-semibold text-jood-green">الحجز عبر جاذر إن</h3>
      <p className="mt-3 leading-8 text-jood-ink/75">{gathern.notice}</p>
      {gathern.url ? (
        <a
          href={gathern.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-jood-green px-6 py-3 text-jood-green transition hover:bg-jood-green hover:text-jood-beige"
        >
          الانتقال إلى جاذر إن
          <ExternalLink aria-hidden className="size-4" />
        </a>
      ) : (
        <PendingNotice className="mt-6">رابط صفحة الاستراحة على جاذر إن قيد الإعداد وسيُضاف قريبًا.</PendingNotice>
      )}
    </div>
  );
}

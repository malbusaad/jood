import { lazy, Suspense } from "react";
import type { SiteContent } from "../content/site";

const PriceCalendar = lazy(() => import("./PriceCalendar"));

/** يؤجّل تحميل مكتبة التقويم حتى لا تبطئ فتح الصفحة. */
export default function LazyPriceCalendar({ prices }: { prices: SiteContent["fullRestPrices"] }) {
  return (
    <Suspense fallback={<div className="h-[26rem] rounded-3xl border border-jood-green/10 bg-white/60" aria-busy="true" />}>
      <PriceCalendar prices={prices} />
    </Suspense>
  );
}

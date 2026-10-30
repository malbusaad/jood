import { lazy, Suspense } from "react";

const PriceCalendar = lazy(() => import("./PriceCalendar"));

/** يؤجّل تحميل مكتبة التقويم حتى لا تبطئ فتح الصفحة. */
export default function LazyPriceCalendar() {
  return (
    <Suspense fallback={<div className="h-[26rem] rounded-3xl border border-jood-green/10 bg-white/60" aria-busy="true" />}>
      <PriceCalendar />
    </Suspense>
  );
}

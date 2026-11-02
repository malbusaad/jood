import type { ReactNode } from "react";
import { useSiteState } from "../hooks/useSiteContent";

/** Renders children once the site content has loaded; shows a calm loading or retry state meanwhile. */
export default function SiteGate({ children }: { children: ReactNode }) {
  const state = useSiteState();
  if (state.status === "ready") return <>{children}</>;
  if (state.status === "error") {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-4 text-center" role="alert">
        <div>
          <p className="text-jood-ink/80">تعذر تحميل محتوى الموقع.</p>
          <button
            type="button"
            onClick={state.retry}
            className="mt-4 rounded-full bg-jood-green px-6 py-2.5 text-jood-beige transition hover:bg-jood-green-800"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-[60dvh] place-items-center" aria-busy="true" aria-label="جارٍ التحميل">
      <span className="size-8 animate-spin rounded-full border-2 border-jood-gold/30 border-t-jood-gold" />
    </div>
  );
}

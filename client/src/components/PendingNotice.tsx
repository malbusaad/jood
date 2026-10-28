import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** تنبيه لبيانات لم يزوّدها المالك بعد — بدل اختراع قيمة. */
export default function PendingNotice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-xl border border-jood-gold/40 bg-jood-gold/10 px-4 py-3 text-sm leading-7 text-jood-ink/80 ${className}`}
    >
      <Info aria-hidden className="mt-1 size-4 shrink-0 text-jood-gold" />
      <span>{children}</span>
    </p>
  );
}

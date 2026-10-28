/**
 * مكان مخصص لشعار استراحة الجود.
 * الشعار الرسمي لم يُزوَّد بعد؛ لن يُنشأ شعار نهائي دون موافقة المالك.
 * سيُستبدل هذا المكون بالشعار المرفوع من لوحة الإدارة.
 */
export default function LogoSlot({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      aria-label="استراحة الجود"
      title="مكان الشعار — بانتظار الشعار الرسمي"
    >
      <span className="grid size-10 place-items-center rounded-md border border-dashed border-jood-gold/70 text-[10px] text-jood-gold">
        الشعار
      </span>
      <span className="font-display text-xl font-semibold tracking-wide">استراحة الجود</span>
    </span>
  );
}

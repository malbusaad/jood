import { useSiteContent } from "../hooks/useSiteContent";

/**
 * شعار استراحة الجود. الشعار الرسمي لم يُزوَّد بعد، فيظهر مكان مخصص له.
 * لن يُنشأ شعار نهائي دون موافقة المالك؛ يُرفع الشعار من لوحة الإدارة.
 */
export default function LogoSlot({ className = "" }: { className?: string }) {
  const { general, media } = useSiteContent();
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      {media.logoUrl ? (
        <img src={media.logoUrl} alt="" className="h-10 w-auto" />
      ) : (
        <span
          className="grid size-10 place-items-center rounded-md border border-dashed border-jood-gold/70 text-[10px] text-jood-gold"
          title="مكان الشعار — بانتظار الشعار الرسمي"
          aria-hidden
        >
          الشعار
        </span>
      )}
      <span className="font-display text-xl font-semibold tracking-wide">{general.name}</span>
    </span>
  );
}

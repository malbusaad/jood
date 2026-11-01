import type { BookingDetail } from "./types";
import { formatDateAr } from "../lib/format";
import { money, nightsBetween } from "./ui";

export function waLink(phone: string, text?: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Ready-made WhatsApp messages for each step of the owner's flow. */
export function waMessages(b: BookingDetail) {
  const name = b.guest.name.split(" ")[0];
  const what = [...new Map(b.items.map((i) => [i.resource.id, i.resource.name])).values()].join("، ");
  const days = nightsBetween(b.startDate, b.endDate);
  const when = `${formatDateAr(b.startDate)}${days > 1 ? ` (${days} أيام)` : ""}`;
  const amounts = `مبلغ الحجز ${money(b.totalAmount)}${Number(b.depositAmount) > 0 ? ` + تأمين ${money(b.depositAmount)} يُسترد بعد المغادرة` : ""}`;
  return [
    {
      key: "contract",
      label: "تأكيد التفاصيل وإرسال العقد",
      text: `مرحبًا ${name}، معك استراحة الجود بخصوص طلب الحجز رقم ${b.reference}.\n${what} — ${when}.\n${amounts}.\nأرسلت لك عقد الحجز، ونرجو قراءته والرد بكلمة «موافق» للموافقة عليه.`,
    },
    {
      key: "payment",
      label: "طلب التحويل",
      text: `شكرًا ${name} على موافقتك. نرجو تحويل ${money(Number(b.totalAmount) + Number(b.depositAmount))} لإتمام الحجز رقم ${b.reference}، وإرسال صورة الإيصال هنا. يتأكد الحجز بعد التحقق من وصول المبلغ.`,
    },
    {
      key: "confirmed",
      label: "تأكيد الحجز",
      text: `تم تأكيد حجزك رقم ${b.reference} في استراحة الجود — ${when}. سعداء باستقبالك!`,
    },
  ];
}

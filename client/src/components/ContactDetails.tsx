import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import PendingNotice from "./PendingNotice";
import type { SiteContent } from "../content/site";

export default function ContactDetails({ site }: { site: SiteContent }) {
  const { phone, whatsapp, email, mapUrl } = site.contact;
  const hasAny = phone || whatsapp || email;
  const row = "flex items-center gap-3";
  return (
    <div className="space-y-4">
      <p className={row}>
        <MapPin aria-hidden className="size-5 text-jood-gold" />
        {site.location.district}، {site.location.city} — {site.location.country}
        {mapUrl && (
          <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-jood-gold underline-offset-4">
            الموقع على الخريطة
          </a>
        )}
      </p>
      {phone && (
        <a href={`tel:${phone}`} className={row} dir="ltr">
          <Phone aria-hidden className="size-5 text-jood-gold" />
          {phone}
        </a>
      )}
      {whatsapp && (
        <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className={row}>
          <MessageCircle aria-hidden className="size-5 text-jood-gold" />
          واتساب
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={row}>
          <Mail aria-hidden className="size-5 text-jood-gold" />
          {email}
        </a>
      )}
      {!hasAny && <PendingNotice>بيانات التواصل (الهاتف وواتساب والبريد) قيد الإعداد وستُضاف قريبًا.</PendingNotice>}
    </div>
  );
}

/** Shapes returned by GET /api/public/site. All values are editable by the owner. */

export type AmenityIconName =
  | "tent"
  | "majlis"
  | "dining"
  | "outdoor"
  | "kitchen"
  | "restroom"
  | "volleyball"
  | "coffee"
  | "kids"
  | "wifi";

export interface Amenity {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** نص السعة كما اعتمده المالك، مثل «12 إلى 15 شخصًا» */
  capacityText: string | null;
  note: string | null;
  icon: AmenityIconName;
  available: boolean;
}

export interface Faq {
  q: string;
  a: string;
}

export interface GalleryImage {
  url: string;
  alt: string;
  amenityId: string | null;
}

export interface SiteContent {
  general: {
    name: string;
    tagline: string;
    welcome: string;
    description: string;
    location: { district: string; city: string; country: string };
  };
  stay: { checkIn: string; checkOut: string };
  houseRules: string[];
  faqs: Faq[];
  contact: { phone: string | null; whatsapp: string | null; email: string | null; mapUrl: string | null };
  gathern: { url: string | null; notice: string };
  cancellationPolicy: { text: string | null };
  amenities: Amenity[];
  /** السعر الأساسي للاستراحة كاملة: 0 = الأحد ... 6 = السبت (null = لا يوجد سعر معتمد) */
  weekdayPrices: (number | null)[];
  media: { logoUrl: string | null; heroImageUrl: string | null; videoUrl: string | null; gallery: GalleryImage[] };
}

export interface CalendarDay {
  date: string;
  price: number | null;
  available: boolean;
}

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
  ticker: {
    enabled: boolean;
    items: { id: string; text: string; active: boolean }[];
    secondsPerItem: number;
    direction: "rtl" | "ltr";
    mobile: "animate" | "static";
  };
  tourismLicense: { enabled: boolean; licenseNumber: string | null; text: string; logoUrl: string | null };
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

export interface BookingOption {
  id: string;
  name: string;
  kind: "FULL" | "PART";
  description: string | null;
  amenities: string[];
  available: boolean;
  total: number | null;
  reason: string | null;
}

export interface QuoteLine {
  date: string;
  resourceId: string;
  resourceName: string;
  price: string;
  ruleKind?: "WEEKDAY" | "SEASON" | "SPECIAL";
  ruleLabel?: string | null;
}

export interface AppliedDiscount {
  code: string;
  amount: number;
}

export type Quote =
  | {
      available: true;
      lines: QuoteLine[];
      /** مبلغ الحجز قبل الخصم */
      subtotal?: number;
      discount?: AppliedDiscount | null;
      discountError?: string | null;
      /** مبلغ الحجز بعد الخصم */
      total: number;
      deposit: number;
      payable: number;
      endDate: string;
    }
  | { available: false; reason: string };

export interface BookingReceipt {
  reference: string;
  status: string;
  startDate: string;
  endDate: string;
  items: string[];
  lines: QuoteLine[];
  subtotal?: number;
  discount?: AppliedDiscount | null;
  total: number;
  deposit: number;
  payable: number;
  bank: { bankName: string | null; accountHolder: string | null; iban: string | null; instructions: string | null } | null;
}

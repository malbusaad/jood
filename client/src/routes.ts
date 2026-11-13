export interface NavItem {
  path: string;
  label: string;
}

/** الصفحات العامة للكتالوج */
export const publicPages: NavItem[] = [
  { path: "/", label: "الرئيسية" },
  { path: "/amenities", label: "المرافق والخدمات" },
  { path: "/gallery", label: "معرض الصور" },
  { path: "/video", label: "الفيديو التعريفي" },
  { path: "/booking", label: "الأسعار والحجز" },
  { path: "/terms", label: "الشروط والتعليمات" },
  { path: "/faq", label: "الأسئلة الشائعة" },
  { path: "/contact", label: "تواصل معنا" },
  { path: "/privacy", label: "سياسة الخصوصية" },
];

import { siteContent, type SiteContent } from "../content/site";

/**
 * مصدر واحد لمحتوى الموقع. يعيد حاليًا القيم المعتمدة الثابتة؛
 * في المرحلة الثالثة يُستبدل بجلب الإعدادات من الخادم.
 */
export function useSiteContent(): SiteContent {
  return siteContent;
}

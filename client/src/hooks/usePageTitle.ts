import { useEffect } from "react";

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | استراحة الجود` : "استراحة الجود | Jood Rest";
  }, [title]);
}

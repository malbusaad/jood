import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { SiteContent } from "../content/types";

type State = { status: "loading" } | { status: "error"; retry: () => void } | { status: "ready"; site: SiteContent };

const SiteContext = createContext<State>({ status: "loading" });

/** Loads the site content (managed from the admin panel) once for the whole app. */
export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    api<SiteContent>("/api/public/site")
      .then((site) => {
        setState({ status: "ready", site });
        applySiteIcon(site.media.iconUrl ?? null);
      })
      .catch(() => setState({ status: "error", retry: load }));
  }, []);

  useEffect(load, [load]);

  return <SiteContext.Provider value={state}>{children}</SiteContext.Provider>;
}

export function useSiteState(): State {
  return useContext(SiteContext);
}

/** Site content for components rendered inside <SiteGate> (content is guaranteed loaded there). */
export function useSiteContent(): SiteContent {
  const state = useContext(SiteContext);
  if (state.status !== "ready") throw new Error("useSiteContent used before content loaded");
  return state.site;
}

/** Uses the owner's uploaded icon for the browser tab and the phone home screen (default icon otherwise). */
function applySiteIcon(url: string | null) {
  if (!url || typeof document === "undefined") return;
  for (const rel of ["icon", "apple-touch-icon"]) {
    let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.href = url;
    link.removeAttribute("type");
  }
}

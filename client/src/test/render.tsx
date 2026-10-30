import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import App from "../App";
import SiteGate from "../components/SiteGate";
import { SiteContentProvider } from "../hooks/useSiteContent";
import type { SiteContent } from "../content/types";
import { calendarFixture, siteFixture } from "./fixtures";

/** Stubs fetch with an in-memory version of the public API. */
export function mockApi({ site = siteFixture, booked = [] as string[], fail = false }: { site?: SiteContent; booked?: string[]; fail?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (fail) return json({ error: "down" }, 500);
    if (url.pathname === "/api/public/site") return json(site);
    if (url.pathname === "/api/public/calendar") {
      return json(calendarFixture(url.searchParams.get("from")!, url.searchParams.get("to")!, site.weekdayPrices, booked));
    }
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderApp(path: string, opts?: Parameters<typeof mockApi>[0]) {
  mockApi(opts);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteContentProvider>
        <SiteGate>
          <App />
        </SiteGate>
      </SiteContentProvider>
    </MemoryRouter>,
  );
}

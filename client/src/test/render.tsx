import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import App from "../App";
import { SiteContentProvider } from "../hooks/useSiteContent";
import type { BookingOption, BookingReceipt, SiteContent } from "../content/types";
import { calendarFixture, siteFixture } from "./fixtures";

/** Stubs fetch with an in-memory version of the public API. */
export interface MockApiOptions {
  site?: SiteContent;
  booked?: string[];
  fail?: boolean;
  options?: BookingOption[];
  booking?: { status: number; body: BookingReceipt | { error: string } };
}

export function mockApi({ site = siteFixture, booked = [], fail = false, options = [], booking }: MockApiOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (fail) return json({ error: "down" }, 500);
    if (url.pathname === "/api/public/site") return json(site);
    if (url.pathname === "/api/public/calendar") {
      return json(calendarFixture(url.searchParams.get("from")!, url.searchParams.get("to")!, site.weekdayPrices, booked));
    }
    if (url.pathname === "/api/public/options") return json({ options, deposit: 500, maxNights: 7 });
    if (url.pathname === "/api/public/quote") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { resourceIds: string[]; startDate: string; nights: number; discountCode?: string };
      const chosen = options.filter((o) => body.resourceIds.includes(o.id));
      const subtotal = chosen.reduce((s, o) => s + (o.total ?? 0), 0);
      // The fake server knows one code: JOOD10 = 10% off.
      const code = body.discountCode?.toUpperCase();
      const discount = code === "JOOD10" ? { code, amount: subtotal / 10 } : null;
      const total = subtotal - (discount?.amount ?? 0);
      return json({
        available: true,
        lines: chosen.map((o) => ({ date: body.startDate, resourceId: o.id, resourceName: o.name, price: String(o.total) })),
        subtotal,
        discount,
        discountError: code && !discount ? "كود الخصم غير صحيح أو غير مفعّل" : null,
        total,
        deposit: 500,
        payable: total + 500,
        endDate: body.startDate,
        paymentOptions: { depositPlan: { percent: 50, upfront: total / 2 }, balanceDueHours: 24 },
      });
    }
    if (url.pathname === "/api/public/bookings" && booking) return json(booking.body, booking.status);
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderApp(path: string, opts?: MockApiOptions) {
  const fetchMock = mockApi(opts);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SiteContentProvider>
        <App />
      </SiteContentProvider>
    </MemoryRouter>,
  );
  return Object.assign(view, { fetchMock });
}

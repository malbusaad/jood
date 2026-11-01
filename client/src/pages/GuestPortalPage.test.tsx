import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "../App";
import { SiteContentProvider } from "../hooks/useSiteContent";
import { siteFixture } from "../test/fixtures";

const portal = {
  siteName: "استراحة الجود",
  guestName: "سارة القحطاني",
  reference: "JD-000007",
  startDate: "2026-12-10",
  endDate: "2026-12-11",
  checkIn: "14:00",
  checkOut: "04:00",
  items: ["الاستراحة كاملة"],
  houseRules: ["المحافظة على نظافة الاستراحة."],
  departureInstructions: ["إطفاء الأنوار وإغلاق الأبواب عند المغادرة."],
  contact: { phone: null, whatsapp: "966501112222", email: null, mapUrl: null },
  location: { district: "العزيزية", city: "الخبر", country: "المملكة العربية السعودية" },
  codes: null as null | { entryCode: string | null; wifiName: string | null; wifiPassword: string | null },
  codesAvailableOn: "2026-12-10" as string | null,
};

const TOKEN = "a".repeat(43);

function renderPortal(response: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.pathname === `/api/guest/${TOKEN}`) return json(response.status, response.body);
    if (url.pathname === "/api/public/site") return json(200, siteFixture);
    return json(404, { error: "not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={[`/g/${TOKEN}`]}>
      <SiteContentProvider>
        <App />
      </SiteContentProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("guest portal page", () => {
  it("greets the guest with their booking, rules and a WhatsApp contact, and says when codes appear", async () => {
    renderPortal({ status: 200, body: portal });
    expect(await screen.findByRole("heading", { name: "أهلًا سارة" })).toBeInTheDocument();
    expect(screen.getByText("JD-000007")).toBeInTheDocument();
    expect(screen.getByText("2:00 ظهرًا")).toBeInTheDocument();
    expect(screen.getByText("4:00 فجرًا")).toBeInTheDocument();
    expect(screen.getByText(/يظهر رمز الدخول وبيانات الواي فاي هنا يوم وصولك/)).toBeInTheDocument();
    expect(screen.getByText("المحافظة على نظافة الاستراحة.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /تواصل معنا عبر واتساب/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/966501112222\?text=/);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  });

  it("shows the entry code and Wi-Fi when available", async () => {
    renderPortal({ status: 200, body: { ...portal, codes: { entryCode: "4321", wifiName: "Jood", wifiPassword: "wifi-pass-1" }, codesAvailableOn: null } });
    expect(await screen.findByText("4321")).toBeInTheDocument();
    expect(screen.getByText("Jood")).toBeInTheDocument();
    expect(screen.getByText("wifi-pass-1")).toBeInTheDocument();
  });

  it("explains an expired or revoked link", async () => {
    renderPortal({ status: 410, body: { error: "انتهت صلاحية هذا الرابط. تواصل معنا إذا احتجت المساعدة." } });
    expect(await screen.findByRole("alert")).toHaveTextContent("انتهت صلاحية هذا الرابط");
  });
});

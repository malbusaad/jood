import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { publicPages } from "./routes";
import { siteContent } from "./content/site";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("home page", () => {
  it("shows welcome, both calls to action and approved prices", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("أهلًا بكم في استراحة الجود");
    expect(screen.getAllByRole("link", { name: "احجز الآن" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "استكشف الاستراحة" })).toHaveAttribute("href", "/amenities");
    expect(screen.getAllByText("950").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,200").length).toBeGreaterThan(0);
  });

  it("shows check-in and check-out times from settings", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("2:00 ظهرًا")).toBeInTheDocument();
    expect(screen.getByText("4:00 فجرًا")).toBeInTheDocument();
  });

  it("does not render fake photos — only placeholders until real media is uploaded", async () => {
    const { container } = renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    // Only the optional logo/hero would be <img>; none are configured yet.
    expect(container.querySelectorAll("main img")).toHaveLength(0);
    expect(screen.getAllByRole("img", { name: "صورة الاستراحة قريبًا" }).length).toBeGreaterThan(0);
  });
});

describe("routing", () => {
  it.each(publicPages.filter((p) => p.path !== "/"))("renders $label at $path", async ({ path, label }) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(label);
  });

  it("renders a not-found page for unknown routes", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("الصفحة غير موجودة");
  });

  it("defines all ten public catalog pages", () => {
    expect(publicPages).toHaveLength(10);
  });
});

describe("amenities page", () => {
  it("lists all eleven approved amenities with capacities and no pool", async () => {
    renderAt("/amenities");
    await screen.findByRole("heading", { level: 1 });
    const main = screen.getByRole("main");
    for (const a of siteContent.amenities) {
      expect(within(main).getByRole("heading", { name: a.name })).toBeInTheDocument();
    }
    expect(within(main).getByText("السعة: 12 إلى 15 شخصًا")).toBeInTheDocument();
    expect(main.textContent).not.toMatch(/مسبح/);
  });
});

describe("booking page", () => {
  it("is honest that online booking is not active yet and offers Gathern with a fee notice", async () => {
    renderAt("/booking");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/استقبال طلبات الحجز عبر الموقع قيد التفعيل/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الحجز عبر جاذر إن" })).toBeInTheDocument();
    expect(screen.getByText(/رسوم المنصة الإضافية قد تُطبق/)).toBeInTheDocument();
    // No Gathern URL configured yet → no external link, pending notice instead.
    expect(screen.queryByRole("link", { name: /الانتقال إلى جاذر إن/ })).toBeNull();
    expect(screen.getByText(/رابط صفحة الاستراحة على جاذر إن قيد الإعداد/)).toBeInTheDocument();
  });

  it("never shows bank account details publicly", async () => {
    renderAt("/booking");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("main").textContent).not.toMatch(/SA\d{2}/);
  });
});

describe("terms page", () => {
  it("lists all house rules", async () => {
    renderAt("/terms");
    await screen.findByRole("heading", { level: 1 });
    for (const rule of siteContent.houseRules) expect(screen.getByText(rule)).toBeInTheDocument();
  });
});

describe("faq page", () => {
  it("renders every question", async () => {
    renderAt("/faq");
    await screen.findByRole("heading", { level: 1 });
    for (const f of siteContent.faqs) expect(screen.getByText(f.q)).toBeInTheDocument();
  });
});

describe("contact page", () => {
  it("shows a pending notice instead of invented contact details", async () => {
    renderAt("/contact");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/بيانات التواصل .* قيد الإعداد/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /واتساب/ })).toBeNull();
  });
});

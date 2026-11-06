import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { publicPages } from "./routes";
import { siteFixture } from "./test/fixtures";
import { renderApp } from "./test/render";

describe("home page", () => {
  it("shows welcome, both calls to action and the prices from the server", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("أهلًا بكم في استراحة الجود");
    expect(screen.getAllByRole("link", { name: "احجز الآن" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "استكشف الاستراحة" })).toHaveAttribute("href", "/amenities");
    expect(screen.getByRole("heading", { name: "الأحد إلى الأربعاء" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الخميس إلى السبت" })).toBeInTheDocument();
    expect(screen.getAllByText("950").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,200").length).toBeGreaterThan(0);
  });

  it("no longer shows the calendar on the home page; «احجز الآن» leads to the booking page that has it", async () => {
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "الأسعار والإتاحة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "احجز الآن" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l).toHaveAttribute("href", "/booking");
  });

  it("shows only the active ticker phrases, in order, on every page", async () => {
    renderApp("/faq");
    const bar = await screen.findByRole("region", { name: "أخبار الاستراحة" });
    expect(within(bar).getAllByText("أهلًا وسهلًا بكم في استراحة الجود.").length).toBeGreaterThan(0);
    expect(within(bar).queryByText("عبارة معطلة")).not.toBeInTheDocument();
    const firstStrip = within(bar).getAllByRole("listitem").map((li) => li.textContent?.replace("✦", "").trim());
    expect(firstStrip.slice(0, 2)).toEqual(["أهلًا وسهلًا بكم في استراحة الجود.", "احجزوا موعدكم الآن."]);
  });

  it("hides the ticker when the owner turns it off", async () => {
    renderApp("/", { site: { ...siteFixture, ticker: { ...siteFixture.ticker, enabled: false } } });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "أخبار الاستراحة" })).not.toBeInTheDocument();
  });

  it("shows the tourism licence only once enabled with a real number, with the uploaded logo", async () => {
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("مرخصة من وزارة السياحة")).not.toBeInTheDocument();
  });

  it("renders the licence band with number and logo", async () => {
    renderApp("/", {
      site: { ...siteFixture, tourismLicense: { enabled: true, licenseNumber: "7300012345", text: "مرخصة من وزارة السياحة", logoUrl: "/api/public/license-logo?v=abc" } },
    });
    const band = await screen.findByRole("region", { name: "الترخيص" });
    expect(within(band).getByText("مرخصة من وزارة السياحة")).toBeInTheDocument();
    expect(within(band).getByText("7300012345")).toBeInTheDocument();
    expect(within(band).getByRole("img", { name: "شعار وزارة السياحة" })).toHaveAttribute("src", "/api/public/license-logo?v=abc");
  });

  it("shows check-in and check-out times from settings", async () => {
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("2:00 ظهرًا")).toBeInTheDocument();
    expect(screen.getByText("4:00 فجرًا")).toBeInTheDocument();
  });

  it("reflects changes the owner makes (times and prices are not hard-coded)", async () => {
    renderApp("/", {
      site: { ...siteFixture, stay: { checkIn: "15:00", checkOut: "03:00" }, weekdayPrices: [1000, 1000, 1000, 1000, 1300, 1300, 1300] },
    });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("3:00 عصرًا")).toBeInTheDocument();
    expect(screen.getByText("3:00 فجرًا")).toBeInTheDocument();
    expect(screen.getAllByText("1,300").length).toBeGreaterThan(0);
    expect(screen.queryByText("950")).toBeNull();
  });

  it("does not render fake photos — only placeholders until real media is uploaded", async () => {
    const { container } = renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelectorAll("main img")).toHaveLength(0);
    expect(screen.getAllByRole("img", { name: "صورة الاستراحة قريبًا" }).length).toBeGreaterThan(0);
  });

  it("offers a retry when the content cannot be loaded", async () => {
    renderApp("/", { fail: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذر تحميل محتوى الموقع");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});

describe("routing", () => {
  it.each(publicPages.filter((p) => p.path !== "/"))("renders $label at $path", async ({ path, label }) => {
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(label);
  });

  it("renders a not-found page for unknown routes", async () => {
    renderApp("/nope");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("الصفحة غير موجودة");
  });

  it("defines all ten public catalog pages", () => {
    expect(publicPages).toHaveLength(10);
  });
});

describe("amenities page", () => {
  it("lists amenities from the server with capacities, marks unavailable ones, no pool", async () => {
    renderApp("/amenities");
    await screen.findByRole("heading", { level: 1 });
    const main = screen.getByRole("main");
    for (const a of siteFixture.amenities) {
      expect(within(main).getByRole("heading", { name: a.name })).toBeInTheDocument();
    }
    expect(within(main).getByText("السعة: 12 إلى 15 شخصًا")).toBeInTheDocument();
    expect(within(main).getAllByText("غير متاح حاليًا")).toHaveLength(1);
    expect(main.textContent).not.toMatch(/مسبح/);
  });
});

describe("booking page", () => {
  it("explains the WhatsApp confirmation step and offers Gathern with a fee notice", async () => {
    renderApp("/booking");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/يتواصل معك المالك عبر واتساب لتأكيد التفاصيل وإرسال العقد/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الحجز عبر جاذر إن" })).toBeInTheDocument();
    expect(screen.getByText(/رسوم المنصة الإضافية قد تُطبق/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /الانتقال إلى جاذر إن/ })).toBeNull();
    expect(screen.getByText(/رابط صفحة الاستراحة على جاذر إن قيد الإعداد/)).toBeInTheDocument();
  });

  it("shows the Gathern button once the owner sets the link", async () => {
    renderApp("/booking", { site: { ...siteFixture, gathern: { ...siteFixture.gathern, url: "https://gathern.co/view/example" } } });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: /الانتقال إلى جاذر إن/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never shows bank account details publicly", async () => {
    renderApp("/booking");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("main").textContent).not.toMatch(/SA\d{2}/);
  });
});

describe("terms page", () => {
  it("lists all house rules and shows the cancellation policy once set", async () => {
    renderApp("/terms", { site: { ...siteFixture, cancellationPolicy: { text: "يُسترد المبلغ كاملًا قبل 7 أيام." } } });
    await screen.findByRole("heading", { level: 1 });
    for (const rule of siteFixture.houseRules) expect(screen.getByText(rule)).toBeInTheDocument();
    expect(screen.getByText("يُسترد المبلغ كاملًا قبل 7 أيام.")).toBeInTheDocument();
  });

  it("shows a pending notice while there is no cancellation policy", async () => {
    renderApp("/terms");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/سياسة الإلغاء والاسترداد يحددها المالك/)).toBeInTheDocument();
  });
});

describe("faq page", () => {
  it("renders every question", async () => {
    renderApp("/faq");
    await screen.findByRole("heading", { level: 1 });
    for (const f of siteFixture.faqs) expect(screen.getByText(f.q)).toBeInTheDocument();
  });
});

describe("contact page", () => {
  it("shows a pending notice instead of invented contact details", async () => {
    renderApp("/contact");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText(/بيانات التواصل .* قيد الإعداد/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /واتساب/ })).toBeNull();
  });

  it("shows WhatsApp once the owner adds it", async () => {
    renderApp("/contact", { site: { ...siteFixture, contact: { ...siteFixture.contact, whatsapp: "966501234567" } } });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: /واتساب/ })).toHaveAttribute("href", "https://wa.me/966501234567");
  });
});

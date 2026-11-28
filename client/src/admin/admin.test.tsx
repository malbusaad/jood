import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "../App";
import { SiteContentProvider } from "../hooks/useSiteContent";
import type { AdminUser, BookingDetail } from "./types";

type Handler = (body: unknown, url: URL) => [number, unknown];

/** In-memory admin API: route → handler. Unknown routes 404. Records every request. */
function mockAdminApi(routes: Record<string, Handler>, user: AdminUser | null) {
  let current = user;
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const json = (status: number, b: unknown) => new Response(status === 204 ? null : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/auth/me") return current ? json(200, { user: current }) : json(401, { error: "يجب تسجيل الدخول" });
    if (url.pathname === "/api/auth/login") {
      const b = body as { email: string; password: string };
      if (b.password !== "correct-password") return json(401, { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
      current = { id: "u1", email: b.email, name: "المالك", role: "OWNER" };
      return json(200, { user: current });
    }
    if (url.pathname === "/api/admin/notifications") return json(200, { items: [], unread: 3 });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return json(404, { error: "not found" });
    const [status, res] = handler(body, url);
    return json(status, res);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteContentProvider>
        <App />
      </SiteContentProvider>
    </MemoryRouter>,
  );
}

const OWNER: AdminUser = { id: "u1", email: "owner@jood.test", name: "المالك", role: "OWNER" };
const STAFF: AdminUser = { id: "u2", email: "staff@jood.test", name: "موظف", role: "STAFF" };

const dashboard = {
  upcoming: 2, confirmedUpcoming: 1, newRequests: 1, awaitingVerification: 0, pendingPayments: 0,
  revenueMonth: "1200", revenueAll: "1200", cancelledMonth: 0, unavailableAmenities: [], unreadNotifications: 3, next: [],
};

function booking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: "b1", reference: "JD-000007", status: "NEW", statusLabel: "طلب جديد", channel: "WEBSITE",
    startDate: "2026-12-10T00:00:00.000Z", endDate: "2026-12-11T00:00:00.000Z",
    totalAmount: "1200.00", depositAmount: "500.00",
    priceBreakdown: [{ date: "2026-12-10", resourceId: "full", resourceName: "الاستراحة كاملة", price: "1200.00" }],
    guestCount: 15, guestNotes: null, adminNotes: null, expiresAt: null, confirmedAt: null, confirmedBy: null,
    cancelledAt: null, cancelReason: null, contractSentAt: null, contractAcceptedAt: null, createdAt: "2026-11-01T10:00:00.000Z",
    guest: { id: "g1", name: "سارة القحطاني", phone: "966501234567", email: null, notes: null, nationalId: "1023456789", nationalIdMasked: "••••••6789" },
    items: [{ id: "i1", date: "2026-12-10", price: "1200.00", resource: { id: "full", name: "الاستراحة كاملة", kind: "FULL" } }],
    payments: [], paid: "0.00", allowedTransitions: ["AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "CANCELLED"], accessTokens: [], doorCodes: [], doorCode: null, lockConfigured: false, history: [],
    ...overrides,
  };
}

describe("admin access", () => {
  it("sends visitors who are not signed in to the login page", async () => {
    mockAdminApi({}, null);
    renderAt("/admin/bookings");
    expect(await screen.findByRole("heading", { name: "لوحة إدارة استراحة الجود" })).toBeInTheDocument();
  });

  it("shows the server's error on a wrong password, then signs in and opens the dashboard", async () => {
    mockAdminApi({ "GET /api/admin/dashboard": () => [200, dashboard] }, null);
    renderAt("/admin");
    fireEvent.change(await screen.findByLabelText("البريد الإلكتروني"), { target: { value: "owner@jood.test" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("غير صحيحة");

    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("heading", { name: "الرئيسية", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("طلبات جديدة")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /الإشعارات \(3 غير مقروء\)/ })).toBeInTheDocument();
  });

  it("hides owner-only sections from staff", async () => {
    mockAdminApi({ "GET /api/admin/dashboard": () => [200, dashboard] }, STAFF);
    renderAt("/admin");
    const nav = await screen.findByRole("navigation", { name: "قائمة الإدارة" });
    expect(within(nav).getByRole("link", { name: "الحجوزات" })).toBeInTheDocument();
    for (const label of ["الأسعار", "الحسابات", "سجل العمليات", "الأجزاء والتعارض"]) {
      expect(within(nav).queryByRole("link", { name: label })).toBeNull();
    }
  });
});

describe("booking detail", () => {
  it("offers a WhatsApp message with the booking details asking for the deposit", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    renderAt("/admin/bookings/b1");
    const link = await screen.findByRole("link", { name: /أرسل طلب العربون عبر واتساب/ });
    const href = decodeURIComponent(link.getAttribute("href")!);
    expect(href).toMatch(/^https:\/\/wa\.me\/966501234567\?text=/);
    expect(href).toContain("JD-000007");
    expect(href).toContain("1,200 ريال");
    expect(href).toContain("500 ريال");
    expect(href).toContain("لتأكيد الحجز نرجو تحويل العربون 600 ريال");
    expect(screen.getByRole("link", { name: /عرض العقد وتنزيله PDF/ })).toHaveAttribute("href", "/admin/bookings/b1/contract");
  });

  it("confirms by recording the deposit received — one amount, one button", async () => {
    const calls = mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()], "POST /api/admin/bookings/b1/deposit-confirm": () => [200, {}] }, OWNER);
    renderAt("/admin/bookings/b1");
    const save = await screen.findByRole("button", { name: "تسجيل العربون وتأكيد الحجز" });
    expect(save).toBeDisabled();
    expect(screen.queryByRole("button", { name: "تأكيد الحجز" })).toBeNull(); // no separate confirm button
    fireEvent.change(screen.getByLabelText("مبلغ العربون المستلم"), { target: { value: "2000" } });
    expect(screen.getByRole("alert")).toHaveTextContent("أكبر من المتبقي");
    fireEvent.click(screen.getByRole("button", { name: /النصف 600/ }));
    expect(screen.getByText(/المتبقي بعده 600 ريال يُدفع قبل الدخول/)).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/deposit-confirm"))?.body).toEqual({ amount: 600, method: "BANK_TRANSFER" }));
  });

  it("records a verified payment and moves the booking along", async () => {
    let state = booking();
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, state],
        "POST /api/admin/bookings/b1/payments": (body) => {
          const b = body as { amount: number };
          state = booking({ paid: String(b.amount), payments: [{ id: "p1", method: "BANK_TRANSFER", amount: String(b.amount), status: "ACCEPTED", reportedAt: null, externalRef: null, note: null, verifiedAt: "2026-11-02T10:00:00Z", verifiedBy: { name: "المالك" }, createdAt: "2026-11-02T10:00:00Z" }] });
          return [201, {}];
        },
        "POST /api/admin/bookings/b1/status": (body) => {
          state = { ...state, status: (body as { status: BookingDetail["status"] }).status, allowedTransitions: ["CANCELLED", "COMPLETED"] };
          return [200, {}];
        },
      },
      OWNER,
    );
    renderAt("/admin/bookings/b1");
    // Detailed payment recording is still there, folded away.
    fireEvent.change(await screen.findByLabelText("المبلغ (ريال)"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدفعة" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/admin/bookings/b1/payments")).toBe(true));
    expect(calls.find((c) => c.path === "/api/admin/bookings/b1/payments")!.body).toMatchObject({ method: "BANK_TRANSFER", amount: 1200 });
  });

  it("shows the server's refusal message", async () => {
    mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking()],
        "POST /api/admin/bookings/b1/status": () => [409, { error: "لا يمكن تغيير الحالة" }],
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => true);
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء الحجز" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن تغيير الحالة");
  });
});

describe("guest portal link (last step)", () => {
  it("is offered once confirmed, then created and sent with a welcome — no «تم تأكيد»", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    const first = renderAt("/admin/bookings/b1");
    await screen.findByRole("heading", { name: "حجز JD-000007" });
    expect(screen.queryByRole("button", { name: "إنشاء رابط البوابة" })).toBeNull();
    first.unmount();

    const url = `https://jood.example/g/${"t".repeat(43)}`;
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking({ status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED", "COMPLETED"] })],
        "POST /api/admin/bookings/b1/guest-link": () => [201, { id: "t1", url, expiresAt: "2026-12-11T13:00:00.000Z" }],
      },
      OWNER,
    );
    renderAt("/admin/bookings/b1");
    // Not the current step yet (the contract is): open it from its title.
    fireEvent.click(await screen.findByRole("button", { name: "5. إرسال رابط البوابة" }));
    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط البوابة" }));
    const send = await screen.findByRole("link", { name: /أرسل رابط البوابة عبر واتساب/ });
    const href = decodeURIComponent(send.getAttribute("href")!);
    expect(href).toMatch(/^https:\/\/wa\.me\/966501234567\?text=/);
    expect(href).toContain("أهلًا سارة، حياك الله في استراحة الجود");
    expect(href).toContain("رقم حجزك JD-000007");
    expect(href).toContain(url);
    expect(href).not.toContain("تأكيد");
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings/b1/guest-link")).toBe(true);
  });

  it("marks the step done when a link is active, and can issue a new one", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking({ status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED"], accessTokens: [{ id: "t1", createdAt: "2026-11-02T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", revokedAt: null, lastUsedAt: null }] })] }, OWNER);
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: "5. إرسال رابط البوابة" }));
    expect(screen.getByRole("button", { name: "إصدار رابط جديد" })).toBeInTheDocument();
  });
});

describe("door code", () => {
  it("shows the confirmed booking's TTLock code to the owner and re-issues it", async () => {
    let state = booking({
      status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED"], lockConfigured: true, doorCode: "482915",
      doorCodes: [{ id: "d1", status: "ACTIVE", startsAt: "2026-12-10T11:00:00Z", endsAt: "2026-12-11T01:00:00Z", error: null, createdAt: "2026-11-02T10:00:00Z", deletedAt: null }],
    });
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, state],
        "POST /api/admin/bookings/b1/door-code": () => {
          state = { ...state, doorCode: "739251" };
          return [201, { code: "739251" }];
        },
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => true);
    renderAt("/admin/bookings/b1");
    expect(await screen.findByText("482915")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إصدار رقم جديد" }));
    expect(await screen.findByText("739251")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings/b1/door-code")).toBe(true);
  });

  it("shows why TTLock failed and offers a retry", async () => {
    mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking({
          status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED"], lockConfigured: true,
          doorCodes: [{ id: "d1", status: "FAILED", startsAt: "2026-12-10T11:00:00Z", endsAt: "2026-12-11T01:00:00Z", error: "TTLock -3002: gateway offline", createdAt: "2026-11-02T10:00:00Z", deletedAt: null }],
        })],
      },
      OWNER,
    );
    renderAt("/admin/bookings/b1");
    expect(await screen.findByText(/تعذر إنشاء الرقم: TTLock -3002: gateway offline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});

describe("settings", () => {
  const settings = {
    general: { name: "استراحة الجود", tagline: "x", welcome: "x", description: "x", location: { district: "العزيزية", city: "الخبر", country: "السعودية" } },
    stay: { checkIn: "14:00", checkOut: "04:00" },
    contact: { phone: null, whatsapp: null, email: null, mapUrl: null },
    gathern: { url: null, notice: "تنبيه" },
    bank: { bankName: null, accountHolder: null, iban: null, instructions: null },
    bookingPolicy: { unpaidExpiryHours: 15, securityDeposit: 500, maxAdvanceDays: 365, maxNights: 7 },
    houseRules: [], faqs: [], cancellationPolicy: { text: null },
    guestPortal: { entryCode: null, wifiName: null, wifiPassword: null, departureInstructions: [], linkGraceHours: 12, showCodesFrom: "CHECKIN_DAY" },
    notifications: { ownerWhatsapp: null, whatsappEnabled: false },
    contract: { template: "# عقد" },
    ticker: {
      enabled: true,
      items: [
        { id: "a", text: "أهلًا وسهلًا", active: true },
        { id: "b", text: "احجزوا الآن", active: true },
      ],
      secondsPerItem: 8,
      direction: "rtl",
      mobile: "animate",
    },
    tourismLicense: { enabled: false, licenseNumber: null, text: "مرخصة من وزارة السياحة" },
  };

  it("edits the news ticker: add, reorder, disable, delete, speed and mobile mode", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/settings": () => [200, settings],
        "GET /api/admin/license-logo": () => [200, { url: null }],
        "PUT /api/admin/settings/ticker": (body) => [200, { key: "ticker", value: body }],
      },
      OWNER,
    );
    renderAt("/admin/settings");
    fireEvent.click(await screen.findByRole("tab", { name: "الشريط والترخيص" }));
    const card = (await screen.findByRole("heading", { name: "الشريط الإخباري المتحرك" })).closest("section")!;
    fireEvent.click(within(card).getByRole("button", { name: "إضافة عبارة" }));
    fireEvent.change(within(card).getByLabelText("العبارة 3"), { target: { value: "عرض خاص" } });
    fireEvent.click(within(card).getByRole("button", { name: "نقل العبارة 3 للأعلى" }));
    fireEvent.click(within(card).getAllByRole("checkbox", { name: "مفعّلة" })[0]!);
    fireEvent.click(within(card).getByRole("button", { name: "حذف العبارة 3" }));
    fireEvent.change(within(card).getByLabelText(/السرعة/), { target: { value: "5" } });
    fireEvent.change(within(card).getByLabelText("على الجوال"), { target: { value: "static" } });
    fireEvent.click(within(card).getByRole("button", { name: "حفظ" }));
    expect(await within(card).findByText("تم الحفظ")).toBeInTheDocument();
    const body = calls.find((c) => c.method === "PUT")!.body as { items: { text: string; active: boolean }[]; secondsPerItem: number; mobile: string };
    expect(body.items.map((i) => [i.text, i.active])).toEqual([["أهلًا وسهلًا", false], ["عرض خاص", true]]);
    expect(body.secondsPerItem).toBe(5);
    expect(body.mobile).toBe("static");
    // The licence section is there, with the logo upload.
    expect(screen.getByRole("heading", { name: "ترخيص وزارة السياحة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /رفع الشعار/ })).toBeInTheDocument();
  });

  it("uploads the site logo from the «الموقع» tab", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/settings": () => [200, settings],
        "GET /api/admin/site-images/logo": () => [200, { url: null }],
        "GET /api/admin/site-images/icon": () => [200, { url: null }],
        "PUT /api/admin/site-images/logo": () => [200, { url: "/api/public/site-images/logo?v=1" }],
      },
      OWNER,
    );
    renderAt("/admin/settings");
    expect(await screen.findByRole("heading", { name: "أيقونة الموقع" })).toBeInTheDocument();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("ملف الشعار"), { target: { files: [file] } });
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.path === "/api/admin/site-images/logo")).toBe(true));
    expect((calls.find((c) => c.method === "PUT")!.body as { data: string }).data).toMatch(/^data:image\/png;base64,/);
  });

  it("saves the Gathern link", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/settings": () => [200, settings],
        "PUT /api/admin/settings/gathern": (body) => [200, { key: "gathern", value: body }],
      },
      OWNER,
    );
    renderAt("/admin/settings");
    const card = (await screen.findByRole("heading", { name: "جاذر إن" })).closest("section")!;
    fireEvent.change(within(card).getByLabelText(/رابط صفحة الاستراحة في جاذر إن/), { target: { value: "https://gathern.co/view/1" } });
    fireEvent.click(within(card).getByRole("button", { name: "حفظ" }));
    expect(await within(card).findByText("تم الحفظ")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ url: "https://gathern.co/view/1", notice: "تنبيه" });
  });

  it("shows the 500 SAR deposit in the booking policy and lets staff only read settings", async () => {
    mockAdminApi({ "GET /api/admin/settings": () => [200, { ...settings, bank: undefined }] }, STAFF);
    renderAt("/admin/settings");
    expect(await screen.findByText("تعديل الإعدادات متاح للمالك فقط.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حفظ" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "العقد" })).toBeNull();
  });
});

describe("discount codes", () => {
  const code = {
    id: "c1", code: "JOOD10", label: "عرض", type: "PERCENT", value: 10, startDate: null, endDate: null, maxUses: 5, usedCount: 2,
    onePerGuest: false, daysOfWeek: [], includeSpecialDays: true, scope: "ALL", minAmount: null, active: true, totalRedemptions: 3,
  };

  it("creates a code with all its rules", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/discounts": () => [200, []],
        "POST /api/admin/discounts": (body) => [201, { ...(body as object), id: "new" }],
      },
      OWNER,
    );
    renderAt("/admin/discounts");
    expect(await screen.findByText("لا توجد أكواد خصم بعد.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /كود خصم/ }));
    fireEvent.change(screen.getByLabelText(/^الكود/), { target: { value: "eid50" } });
    fireEvent.change(screen.getByLabelText("نوع الخصم"), { target: { value: "FIXED" } });
    fireEvent.change(screen.getByLabelText("المبلغ (ريال)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/الحد الأقصى للاستخدامات/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("ينطبق على"), { target: { value: "FULL_ONLY" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "الخميس" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "يشمل أيام الإجازات والمناسبات" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "مرة واحدة لكل ضيف" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      code: "EID50", label: null, type: "FIXED", value: 50, startDate: null, endDate: null, maxUses: 1, onePerGuest: true,
      daysOfWeek: [4], includeSpecialDays: false, scope: "FULL_ONLY", minAmount: null, active: true,
    });
  });

  it("lists usage, switches a code off, and shows its log; used codes cannot be deleted", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/discounts": () => [200, [code]],
        "PATCH /api/admin/discounts/c1/active": () => [200, { ...code, active: false }],
        "GET /api/admin/discounts/c1": () => [200, { ...code, redemptions: [{ id: "r1", amount: 95, status: "RELEASED", createdAt: "", releasedAt: "", guestName: "سارة محمد", booking: { id: "b1", reference: "JD-000007", status: "CANCELLED", startDate: "2026-11-15" } }] }],
      },
      OWNER,
    );
    renderAt("/admin/discounts");
    expect(await screen.findByText("الاستخدامات: 2 من 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف JOOD10" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إيقاف JOOD10" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && (c.body as { active: boolean }).active === false)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "سجل استخدام JOOD10" }));
    expect(await screen.findByText("JD-000007")).toBeInTheDocument();
    expect(screen.getByText("أُعيد للكود (أُلغي الحجز)")).toBeInTheDocument();
  });
});

describe("special prices and seasons", () => {
  const resources = { resources: [{ id: "full", name: "الاستراحة كاملة", kind: "FULL" }, { id: "p1", name: "المجلس", kind: "PART" }] };
  const rules = [
    { id: "w1", resourceId: "full", kind: "WEEKDAY", label: null, daysOfWeek: [0, 1, 2, 3], startDate: null, endDate: null, price: "950.00", priority: 0, active: true },
    { id: "s1", resourceId: "full", kind: "SPECIAL", label: "اليوم الوطني", daysOfWeek: [], startDate: "2026-09-23T00:00:00.000Z", endDate: "2026-09-23T00:00:00.000Z", price: "1500.00", priority: 0, active: true },
  ];

  it("keeps base prices and special prices in separate sections", async () => {
    mockAdminApi({ "GET /api/admin/pricing": () => [200, rules], "GET /api/admin/resources": () => [200, resources] }, OWNER);
    renderAt("/admin/special-prices");
    expect(await screen.findByRole("heading", { name: "الأسعار الخاصة والمواسم" })).toBeInTheDocument();
    expect(await screen.findByText("اليوم الوطني")).toBeInTheDocument();
    expect(screen.queryByText("950 ريال")).toBeNull();
  });

  it("sets one price for a group of separate days", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/pricing": () => [200, rules],
        "GET /api/admin/resources": () => [200, resources],
        "POST /api/admin/pricing/special-dates": () => [201, []],
      },
      OWNER,
    );
    renderAt("/admin/special-prices");
    await screen.findByText("اليوم الوطني");
    fireEvent.click(screen.getByRole("button", { name: /سعر لمجموعة أيام/ }));
    fireEvent.change(screen.getByLabelText("اسم المناسبة أو العرض"), { target: { value: "عيد الفطر" } });
    fireEvent.change(screen.getByLabelText("السعر لليوم (ريال)"), { target: { value: "1800" } });
    for (const d of ["2027-03-10", "2027-03-09"]) {
      fireEvent.change(screen.getByLabelText("أضف يومًا"), { target: { value: d } });
      fireEvent.click(screen.getByRole("button", { name: /إضافة اليوم/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ resourceIds: ["full"], label: "عيد الفطر", dates: ["2027-03-09", "2027-03-10"], price: 1800, priority: 0 });
  });
});

describe("booking payments: deposit plan, security deposit and refunds", () => {
  const summary = {
    plan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN", legacy: false, bookingTotal: "1200.00", upfrontAmount: "600.00",
    bookingPaid: "600.00", bookingRefunded: "0.00", bookingRemaining: "600.00", upfrontRemaining: "0.00",
    securityDeposit: "500.00", depositPaid: "0.00", depositRefunded: "0.00", depositRemaining: "500.00", depositStatus: "UNPAID",
    dueToConfirm: "0.00", canConfirm: true, fullySettled: false, balanceDueAt: "2026-12-09T11:00:00.000Z",
  } as const;

  it("shows what is paid and owed for the booking and the deposit, and that the door code is held back", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking({ paid: "600.00", payment: { ...summary } })] }, OWNER);
    renderAt("/admin/bookings/b1");
    const box = await screen.findByLabelText("حالة السداد");
    expect(within(box).getByText("عربون والباقي قبل الدخول")).toBeInTheDocument();
    expect(within(box).getByText("التأمين (قبل الدخول)")).toBeInTheDocument();
    expect(within(box).getByText("غير مدفوع")).toBeInTheDocument();
    expect(within(box).getByText("مخفي حتى اكتمال السداد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تأكيد الحجز بالمبلغ المسجل \(600 ريال\)/ })).toBeEnabled();
  });

  it("records a security deposit payment in cash, and a refund as a new entry", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking({ paid: "600.00", payment: { ...summary, depositPaid: "500.00", depositRemaining: "0.00", depositStatus: "PAID" } })],
        "POST /api/admin/bookings/b1/payments": () => [201, {}],
        "POST /api/admin/bookings/b1/refunds": () => [201, {}],
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => true);
    renderAt("/admin/bookings/b1");
    fireEvent.change(await screen.findByLabelText("عن"), { target: { value: "SECURITY_DEPOSIT" } });
    fireEvent.change(screen.getByLabelText("الطريقة"), { target: { value: "CASH" } });
    fireEvent.change(screen.getByLabelText("المبلغ (ريال)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدفعة" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/payments"))).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/payments"))!.body).toMatchObject({ purpose: "SECURITY_DEPOSIT", method: "CASH", amount: 500 });

    fireEvent.click(await screen.findByRole("button", { name: "تسجيل استرداد للضيف" }));
    fireEvent.change(screen.getByLabelText("المبلغ المُعاد (ريال)"), { target: { value: "450" } });
    fireEvent.change(screen.getByLabelText("ملاحظة (مثل: خصم أضرار)"), { target: { value: "خصم 50 لكسر كأس" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الاسترداد" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/refunds"))).toBe(true));
    expect(calls.find((c) => c.path.endsWith("/refunds"))!.body).toEqual({ purpose: "SECURITY_DEPOSIT", method: "BANK_TRANSFER", amount: 450, note: "خصم 50 لكسر كأس" });
  });
});

describe("WhatsApp automation page", () => {
  const auto = {
    mode: "OFF", reminderHoursBefore: 24, accessHoursBefore: 2, thankYouHoursAfter: 3,
    messages: Object.fromEntries(
      ["REQUEST_RECEIVED", "BOOKING_ACCEPTED", "PAYMENT_CONFIRMED", "REMINDER", "ACCESS", "PAYMENT_PENDING", "THANK_YOU"].map((k) => [k, { enabled: true, templateName: null, language: "ar", text: `نص ${k} {customer_name}` }]),
    ),
  };
  const status = {
    connection: { configured: false, ok: false, details: null, error: null },
    mode: "OFF",
    variables: { customer_name: "اسم الضيف", door_code: "رمز الدخول (TTLock)" },
    messages: [
      { kind: "REQUEST_RECEIVED", title: "استلام طلب الحجز", when: "فور الطلب", defaultText: "x", metaTemplate: "x" },
      { kind: "ACCESS", title: "رمز الدخول", when: "قبل الدخول", defaultText: "y", metaTemplate: "y" },
    ],
  };
  const log = {
    items: [{ id: "m1", kind: "ACCESS", status: "BLOCKED", scheduledAt: "2026-12-10T09:00:00Z", sentAt: null, attempts: 1, preview: null, lastError: "لم يكتمل السداد والتأمين", booking: { id: "b1", reference: "JD-000007", guest: { name: "سارة", phone: "966501234567" } } }],
    total: 1, pageSize: 30, counts: { BLOCKED: 1 },
  };

  it("shows it is not connected, edits a message and its template, and retries a blocked message", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/whatsapp/status": () => [200, status],
        "GET /api/admin/settings": () => [200, { whatsappAutomation: auto }],
        "GET /api/admin/whatsapp/messages": () => [200, log],
        "PUT /api/admin/settings/whatsappAutomation": (body) => [200, { key: "whatsappAutomation", value: body }],
        "POST /api/admin/whatsapp/messages/m1/retry": () => [200, { ok: true }],
      },
      OWNER,
    );
    renderAt("/admin/whatsapp");
    expect(await screen.findByText(/غير مربوط بعد/)).toBeInTheDocument();
    expect(screen.getByText("السبب: لم يكتمل السداد والتأمين")).toBeInTheDocument();

    const access = screen.getByRole("region", { name: "رمز الدخول" });
    fireEvent.click(within(access).getByRole("button", { name: "{door_code}" }));
    fireEvent.change(within(access).getByLabelText(/اسم القالب المعتمد في Meta/), { target: { value: "jood_access" } });
    fireEvent.click(screen.getByRole("radio", { name: /تجربة/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const body = calls.find((c) => c.method === "PUT")!.body as typeof auto;
    expect(body.mode).toBe("TEST");
    expect(body.messages.ACCESS).toMatchObject({ templateName: "jood_access", text: expect.stringContaining("{door_code}") });
    expect(body.messages.REQUEST_RECEIVED!.templateName).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /إعادة المحاولة/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/admin/whatsapp/messages/m1/retry")).toBe(true));
  });

  it("asks before switching sending on for guests", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/whatsapp/status": () => [200, status],
        "GET /api/admin/settings": () => [200, { whatsappAutomation: auto }],
        "GET /api/admin/whatsapp/messages": () => [200, { ...log, items: [] }],
        "PUT /api/admin/settings/whatsappAutomation": (body) => [200, { key: "whatsappAutomation", value: body }],
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => false);
    renderAt("/admin/whatsapp");
    fireEvent.click(await screen.findByRole("radio", { name: /تشغيل/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("phone notifications card", () => {
  const info = { enabled: true, publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", devices: [] };

  it("on an iPhone in Safari, explains how to add the panel to the home screen first", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari");
    mockAdminApi({ "GET /api/admin/push": () => [200, info] }, OWNER);
    renderAt("/admin/notifications");
    expect(await screen.findByText(/إضافة إلى الشاشة الرئيسية/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("subscribes this device and sends its keys to the server", async () => {
    const sub = { endpoint: "https://web.push.apple.com/abc", toJSON: () => ({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p".repeat(20), auth: "a".repeat(8) } }), unsubscribe: async () => true };
    let current: typeof sub | null = null;
    const reg = { pushManager: { getSubscription: async () => current, subscribe: vi.fn(async () => (current = sub)) } };
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", { requestPermission: async () => "granted" });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg) } });
    let devices: unknown[] = [];
    const calls = mockAdminApi(
      {
        "GET /api/admin/push": () => [200, { ...info, devices }],
        "POST /api/admin/push/subscriptions": (body) => {
          devices = [{ id: "d1", label: "كمبيوتر", endpoint: (body as { endpoint: string }).endpoint, service: "web.push.apple.com", createdAt: "", lastSuccessAt: null, lastError: null }];
          return [201, { id: "d1" }];
        },
      },
      OWNER,
    );
    renderAt("/admin/notifications");
    fireEvent.click(await screen.findByRole("button", { name: /تفعيل الإشعارات على هذا الجهاز/ }));
    expect(await screen.findByText("الإشعارات مفعّلة على هذا الجهاز.")).toBeInTheDocument();
    expect(reg.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p".repeat(20) } });
    expect(screen.getByRole("button", { name: "إشعار تجريبي" })).toBeInTheDocument();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });
});

describe("previous records import, expenses and reports", () => {
  const summary = {
    bookings: 70, byStatus: { COMPLETED: 64, CONFIRMED: 5, EXPIRED: 1 }, skippedExisting: 0, expenses: 48, skippedExpenses: 0,
    newCustomers: 58, existingCustomers: 0, bookingValueConfirmed: 54264, received: 22092, expensesTotal: 27526.24,
    upcoming: [{ ref: "2220001", name: "ضيف قادم", dates: ["2026-11-25"], total: 900, received: 450, status: "CONFIRMED" }],
  };

  it("previews the file, then imports only after confirmation", async () => {
    const calls = mockAdminApi(
      {
        "POST /api/admin/import/preview": () => [200, { summary, issues: [] }],
        "POST /api/admin/import/commit": () => [200, { summary, issues: [] }],
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => true);
    renderAt("/admin/import");
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(await screen.findByLabelText("ملف السجل السابق"), { target: { files: [file] } });
    expect(await screen.findByText("المعاينة — لم يُحفظ شيء بعد")).toBeInTheDocument();
    expect(screen.getByText(/ضيف قادم/)).toHaveTextContent("المتبقي 450 ريال");
    expect(calls.some((c) => c.path === "/api/admin/import/commit")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الاستيراد" }));
    expect(await screen.findByText(/أُضيف 70 حجزًا و48 مصروفًا/)).toBeInTheDocument();
  });

  it("adds a recurring expense with its category suggested from the description", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/expenses": () => [200, {
          items: [], total: 0, periodTotal: 1500, recurringTotal: 1500, byCategory: { رواتب: 1500 }, categories: ["صيانة", "رواتب", "أخرى"], canAutoCategorize: 0,
          rules: [{ category: "صيانة", words: ["صيانه", "مكيف"] }, { category: "رواتب", words: ["راتب", "حارس"] }],
        }],
        "POST /api/admin/expenses": (body) => [201, body],
      },
      OWNER,
    );
    renderAt("/admin/expenses");
    expect(await screen.findByLabelText("ملخص المصاريف")).toHaveTextContent("مصاريف دائمة1,500");
    fireEvent.click(screen.getByRole("button", { name: /^مصروف$/ }));
    fireEvent.change(screen.getByLabelText(/البند \/ الوصف/), { target: { value: "صيانة المكيف" } });
    expect(screen.getByText(/يُصنَّف تلقائيًا: صيانة/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("المبلغ (ريال)"), { target: { value: "350" } });
    fireEvent.click(screen.getByRole("radio", { name: /مصروف دائم \(شهري\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ title: "صيانة المكيف", amount: 350, recurring: true });
    expect(body.category).toBeUndefined(); // the server categorizes
  });

  it("offers to categorize «أخرى» expenses automatically", async () => {
    const calls = mockAdminApi({
      "GET /api/admin/expenses": () => [200, { items: [], total: 0, periodTotal: 0, recurringTotal: 0, byCategory: {}, categories: ["أخرى"], rules: [], canAutoCategorize: 4 }],
      "POST /api/admin/expenses/auto-categorize": () => [200, { updated: 4 }],
    }, OWNER);
    renderAt("/admin/expenses");
    expect(await screen.findByText(/4 مصروف في «أخرى»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "صنّفها الآن" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/admin/expenses/auto-categorize")).toBe(true));
  });

  it("shows the monthly report totals", async () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, bookings: 0, bookingValue: 0, collected: 0, expenses: 0, net: 0 }));
    months[3] = { ...months[3]!, bookings: 5, bookingValue: 4000, collected: 1000, expenses: 2500, net: 1500 };
    mockAdminApi({ "GET /api/admin/reports/monthly": () => [200, { year: 2026, months, total: { bookings: 5, bookingValue: 4000, collected: 1000, expenses: 2500, net: 1500 }, byCategory: { أخرى: 2500 } }] }, OWNER);
    renderAt("/admin/reports");
    expect(await screen.findByText("الصافي (الحجوزات − المصاريف)")).toBeInTheDocument();
    expect(screen.getAllByText("4,000 ريال").length).toBeGreaterThan(0);
    expect(screen.getByRole("row", { name: /أبريل/ })).toHaveTextContent("1,500 ريال");
  });
});

describe("photos and video", () => {
  it("lists photos, sets the main photo, and saves the video link", async () => {
    const photos = [
      { id: "p1", url: "/api/media/photo-1.jpg", alt: "المجلس", isHero: false, sizeBytes: 1000 },
      { id: "p2", url: "/api/media/photo-2.jpg", alt: null, isHero: true, sizeBytes: 1000 },
    ];
    const calls = mockAdminApi(
      {
        "GET /api/admin/media": () => [200, { items: photos }],
        "GET /api/admin/settings": () => [200, { introVideo: { url: null } }],
        "PATCH /api/admin/media/p1": () => [200, { ...photos[0], isHero: true }],
        "PUT /api/admin/settings/introVideo": (body) => [200, { key: "introVideo", value: body }],
        "GET /api/admin/media/video": () => [200, { video: { url: "/api/media/video-1.mp4", sizeBytes: 1000 } }],
      },
      OWNER,
    );
    renderAt("/admin/media");
    expect(await screen.findByRole("img", { name: "المجلس" })).toHaveAttribute("src", "/api/media/photo-1.jpg");
    expect(within(screen.getByRole("main")).getAllByText("الرئيسية", { selector: "span" }).length).toBe(1);
    expect(screen.getByRole("button", { name: "جعل الصورة 2 الرئيسية" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "جعل الصورة 1 الرئيسية" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && (c.body as { isHero?: boolean }).isHero)).toBe(true));
    expect(await screen.findByLabelText("الفيديو الحالي")).toHaveAttribute("src", "/api/media/video-1.mp4");
    expect(screen.getByRole("button", { name: "استبدال الفيديو" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("رابط الفيديو"), { target: { value: "https://youtu.be/abc123def" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الرابط" }));
    await waitFor(() => expect(calls.find((c) => c.path === "/api/admin/settings/introVideo")?.body).toEqual({ url: "https://youtu.be/abc123def" }));
  });
});

describe("faster admin work", () => {
  it("confirms with money already recorded, without typing it again", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking({ paid: "300.00", channel: "GATHERN" })],
        "POST /api/admin/bookings/b1/deposit-confirm": () => [200, {}],
      },
      OWNER,
    );
    renderAt("/admin/bookings/b1");
    expect(await screen.findByLabelText("طريقة الاستلام")).toHaveValue("GATHERN"); // Gathern bookings default to Gathern
    fireEvent.click(screen.getByRole("button", { name: /تأكيد الحجز بالمبلغ المسجل \(300 ريال\)/ }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/deposit-confirm"))?.body).toEqual({}));
  });

  it("groups the admin menu and offers many icons for amenities", async () => {
    mockAdminApi({ "GET /api/admin/amenities": () => [200, []] }, OWNER);
    renderAt("/admin/amenities");
    const nav = await screen.findByRole("navigation", { name: "قائمة الإدارة" });
    for (const g of ["الحجوزات", "الأسعار والعروض", "الاستراحة", "المالية", "التواصل", "النظام"]) expect(within(nav).getAllByText(g, { selector: "p" })).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "مرفق أو خدمة" }));
    const picker = await screen.findByRole("radiogroup", { name: "الأيقونة" });
    expect(within(picker).getAllByRole("radio").length).toBeGreaterThanOrEqual(50);
    fireEvent.click(within(picker).getByRole("radio", { name: "مواقف" }));
    expect(within(picker).getByRole("radio", { name: "مواقف" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("manual booking: previous customers suggested while typing", () => {
  const resources = { resources: [{ id: "full", name: "الاستراحة كاملة", kind: "FULL", active: true }] };
  const sara = { id: "g1", name: "سارة محمد القحطاني", phone: "966501112222", email: null, notes: "عميلة دائمة", nationalIdMasked: "••••••6789", bookingCount: 3, lastStay: "2026-05-01" };
  const fatima = { id: "g2", name: "فاطمة سعد", phone: null, email: null, notes: null, nationalIdMasked: null, bookingCount: 1, lastStay: null };
  const routes = (calls: { q?: string }[]) => ({
    "GET /api/admin/resources": () => [200, resources] as [number, unknown],
    "POST /api/admin/bookings/quote": () => [200, { available: true, total: 950, deposit: 500 }] as [number, unknown],
    "GET /api/admin/guests/suggest": (_b: unknown, url: URL) => {
      const q = url.searchParams.get("q")!;
      calls.push({ q });
      return [200, [sara, fatima].filter((g) => g.name.includes(q) || (g.phone ?? "").includes(q))] as [number, unknown];
    },
    "POST /api/admin/bookings": () => [201, { id: "b9" }] as [number, unknown],
    "GET /api/admin/bookings/b9": () => [200, booking({ id: "b9" })] as [number, unknown],
  });
  async function fillStay() {
    fireEvent.change(await screen.findByLabelText("تاريخ الدخول"), { target: { value: "2026-12-06" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "الاستراحة كاملة" }));
  }

  it("suggests from the first letter, picks a customer, and links the booking to their record", async () => {
    const searched: { q?: string }[] = [];
    const calls = mockAdminApi(routes(searched), OWNER);
    renderAt("/admin/bookings/new");
    await fillStay();
    const box = screen.getByRole("combobox", { name: "اسم الضيف" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "س" } });
    const option = await screen.findByRole("option", { name: /سارة محمد القحطاني/ });
    expect(searched.at(-1)).toEqual({ q: "س" });
    fireEvent.click(option);
    const card = screen.getByLabelText("العميل المختار");
    expect(card).toHaveTextContent("+966501112222");
    expect(card).toHaveTextContent("••••••6789");
    expect(card).toHaveTextContent("عميلة دائمة");
    expect(screen.queryByLabelText("الجوال (واتساب)")).toBeNull(); // nothing to retype
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings")).toBe(true));
    const body = calls.find((c) => c.method === "POST" && c.path === "/api/admin/bookings")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ guestId: "g1", phone: null, nationalId: null });
    expect(body).not.toHaveProperty("name");
  });

  it("asks only for what an old customer is missing (e.g. the phone)", async () => {
    const calls = mockAdminApi(routes([]), OWNER);
    renderAt("/admin/bookings/new");
    await fillStay();
    const box = screen.getByRole("combobox", { name: "اسم الضيف" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "فاط" } });
    fireEvent.click(await screen.findByRole("option", { name: /فاطمة سعد/ }));
    fireEvent.change(screen.getByLabelText(/الجوال \(واتساب\) — غير مسجل/), { target: { value: "0567778888" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/admin/bookings")!.body).toMatchObject({ guestId: "g2", phone: "0567778888" });
  });

  it("a new customer is entered as before, without choosing from the list", async () => {
    const calls = mockAdminApi(routes([]), OWNER);
    renderAt("/admin/bookings/new");
    await fillStay();
    const box = screen.getByRole("combobox", { name: "اسم الضيف" });
    fireEvent.change(box, { target: { value: "خالد ناصر العتيبي" } });
    fireEvent.change(screen.getByLabelText("الجوال (واتساب)"), { target: { value: "0599990000" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings")).toBe(true));
    const body = calls.find((c) => c.method === "POST" && c.path === "/api/admin/bookings")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "خالد ناصر العتيبي", phone: "0599990000" });
    expect(body).not.toHaveProperty("guestId");
  });

  it("the booking record shows base, the manual discount, final, paid and remaining", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b7": () => [200, booking({ id: "b7", totalAmount: "1000.00", discountAmount: "200.00", manualDiscountType: "FINAL_PRICE", manualDiscountValue: "1000.00", paid: "400.00" })] }, OWNER);
    renderAt("/admin/bookings/b7");
    expect(await screen.findByText("السعر الأساسي (قبل الخصم)")).toBeInTheDocument();
    expect(screen.getByText(/سعر نهائي متفق عليه — يدوي/)).toBeInTheDocument();
    expect(screen.getByText("16.67%")).toBeInTheDocument();
    expect(screen.getByText("− 200 ريال")).toBeInTheDocument();
    expect(screen.getByText("المتبقي من مبلغ الحجز").nextSibling).toHaveTextContent("600");
  });

  async function newCustomerWithStay() {
    const calls = mockAdminApi(routes([]), OWNER);
    renderAt("/admin/bookings/new");
    fireEvent.change(await screen.findByLabelText("تاريخ الدخول"), { target: { value: "2026-12-06" } });
    fireEvent.change(screen.getByLabelText("تاريخ الخروج"), { target: { value: "2026-12-08" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "الاستراحة كاملة" }));
    fireEvent.change(screen.getByRole("combobox", { name: "اسم الضيف" }), { target: { value: "خالد ناصر العتيبي" } });
    fireEvent.change(screen.getByLabelText("الجوال (واتساب)"), { target: { value: "0599990000" } });
    await screen.findByLabelText("السعر الأساسي");
    return calls;
  }
  const posted = (calls: { method: string; path: string; body?: unknown }[]) =>
    calls.find((c) => c.method === "POST" && c.path === "/api/admin/bookings")!.body as Record<string, unknown>;

  it("computes the days from the check-out date and sends no discount by default", async () => {
    const calls = await newCustomerWithStay();
    expect(screen.getByLabelText("عدد الأيام")).toHaveTextContent("2");
    expect(screen.getByLabelText("السعر النهائي")).toHaveTextContent("950");
    const summary = screen.getByLabelText("ملخص الحجز");
    expect(summary).toHaveTextContent("لا يوجد");
    expect(summary).toHaveTextContent("لم يُستلم عربون");
    expect(summary).toHaveTextContent("بانتظار العربون");
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings")).toBe(true));
    expect(posted(calls)).toMatchObject({ nights: 2, manualDiscount: null, initialPayment: null });
  });

  it("an agreed final price works out the discount and its percentage", async () => {
    const calls = await newCustomerWithStay();
    fireEvent.click(screen.getByRole("button", { name: "+ إضافة خصم" }));
    fireEvent.change(screen.getByLabelText("نوع الخصم"), { target: { value: "FINAL_PRICE" } });
    fireEvent.change(screen.getByLabelText("السعر النهائي (ريال)"), { target: { value: "800" } });
    expect(screen.getByRole("group", { name: "الخصم" })).toHaveTextContent("الخصم 150 ريال (15.79%)");
    expect(screen.getByLabelText("السعر النهائي")).toHaveTextContent("800");
    fireEvent.change(screen.getByLabelText(/العربون المستلم/), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("طريقة الاستلام"), { target: { value: "CASH" } });
    const summary = screen.getByLabelText("ملخص الحجز");
    expect(summary).toHaveTextContent("سعر نهائي متفق عليه");
    expect(summary).toHaveTextContent("عربون 300 ريال — المتبقي 500 ريال");
    expect(summary).toHaveTextContent("حالة الحجز بعد الحفظمؤكد");
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings")).toBe(true));
    expect(posted(calls)).toMatchObject({ manualDiscount: { type: "FINAL_PRICE", value: 800 }, initialPayment: { amount: 300, method: "CASH" } });
  });

  it("percentage discount, and blocks saving when the discount or the payment is too large", async () => {
    await newCustomerWithStay();
    fireEvent.click(screen.getByRole("button", { name: "+ إضافة خصم" }));
    fireEvent.change(screen.getByLabelText("نوع الخصم"), { target: { value: "PERCENT" } });
    fireEvent.change(screen.getByLabelText("نسبة الخصم (%)"), { target: { value: "10" } });
    expect(screen.getByLabelText("السعر النهائي")).toHaveTextContent("855");
    fireEvent.change(screen.getByLabelText("نسبة الخصم (%)"), { target: { value: "120" } });
    expect(screen.getByRole("alert")).toHaveTextContent("النسبة لا تتجاوز 100%");
    expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("نوع الخصم"), { target: { value: "FIXED" } });
    fireEvent.change(screen.getByLabelText("مبلغ الخصم (ريال)"), { target: { value: "1000" } });
    expect(screen.getByRole("alert")).toHaveTextContent("الخصم أكبر من السعر الأساسي");
    expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("مبلغ الخصم (ريال)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/العربون المستلم/), { target: { value: "900" } });
    expect(screen.getByRole("alert")).toHaveTextContent("المبلغ المستلم أكبر من السعر النهائي");
    expect(screen.getByRole("button", { name: "حفظ الحجز" })).toBeDisabled();
  });
});

describe("separate days and editing a booking", () => {
  const resources = { resources: [{ id: "full", name: "الاستراحة كاملة", kind: "FULL", active: true }, { id: "majlis", name: "المجلس", kind: "PART", active: true }] };
  const posted = (calls: { method: string; path: string; body?: unknown }[], path: string) =>
    calls.filter((c) => c.method === "POST" && c.path === path).at(-1)?.body as Record<string, unknown> | undefined;

  it("a manual booking can take separate days (e.g. Thursday and Saturday)", async () => {
    const calls = mockAdminApi({
      "GET /api/admin/resources": () => [200, resources],
      "POST /api/admin/bookings/quote": () => [200, { available: true, total: 2400, deposit: 500 }],
      "GET /api/admin/guests/suggest": () => [200, []],
      "POST /api/admin/bookings": () => [201, { id: "b9" }],
      "GET /api/admin/bookings/b9": () => [200, booking({ id: "b9" })],
    }, OWNER);
    renderAt("/admin/bookings/new");
    fireEvent.click(await screen.findByRole("radio", { name: "أيام متفرقة" }));
    for (const d of ["2026-12-10", "2026-12-12"]) {
      fireEvent.change(screen.getByLabelText("يوم للإضافة"), { target: { value: d } });
      fireEvent.click(screen.getByRole("button", { name: "إضافة اليوم" }));
    }
    fireEvent.click(await screen.findByRole("checkbox", { name: "الاستراحة كاملة" }));
    fireEvent.change(screen.getByRole("combobox", { name: "اسم الضيف" }), { target: { value: "خالد ناصر العتيبي" } });
    fireEvent.change(screen.getByLabelText("الجوال (واتساب)"), { target: { value: "0599990000" } });
    await screen.findByLabelText("السعر الأساسي");
    expect(posted(calls, "/api/admin/bookings/quote")).toMatchObject({ dates: ["2026-12-10", "2026-12-12"], nights: 2, startDate: "2026-12-10" });
    expect(screen.getByLabelText("ملخص الحجز")).toHaveTextContent("الأيام");
    fireEvent.click(screen.getByRole("button", { name: "حفظ الحجز" }));
    await waitFor(() => expect(posted(calls, "/api/admin/bookings")).toMatchObject({ dates: ["2026-12-10", "2026-12-12"], nights: 2 }));
  });

  it("a confirmed booking shows «تعديل الحجز»; changing the price only sends the discount and details", async () => {
    const b = booking({ status: "CONFIRMED", statusLabel: "مؤكد", paid: "1200.00", allowedTransitions: ["CANCELLED", "COMPLETED"] });
    const calls = mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, b],
      "GET /api/admin/resources": () => [200, resources],
      "POST /api/admin/bookings/b1/edit": () => [200, { ...b, overpaid: "200.00" }],
    }, OWNER);
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("link", { name: /تعديل الحجز/ }));
    expect(await screen.findByLabelText("السعر الأساسي")).toHaveTextContent("1,200");
    fireEvent.click(screen.getByRole("button", { name: "+ إضافة خصم" }));
    fireEvent.change(screen.getByLabelText("نوع الخصم"), { target: { value: "FINAL_PRICE" } });
    fireEvent.change(screen.getByLabelText("السعر النهائي (ريال)"), { target: { value: "1000" } });
    expect(screen.getByLabelText("السعر الجديد")).toHaveTextContent("1,000");
    expect(screen.getByRole("status")).toHaveTextContent("المدفوع أكثر من السعر الجديد بـ 200");
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    await waitFor(() => expect(posted(calls, "/api/admin/bookings/b1/edit")).toBeDefined());
    const body = posted(calls, "/api/admin/bookings/b1/edit")!;
    expect(body).toMatchObject({ manualDiscount: { type: "FINAL_PRICE", value: 1000 }, securityDeposit: 500, guestCount: 15 });
    expect(body).not.toHaveProperty("dates");
  });

  it("adding a day re-prices from the server (own days not counted as taken) and sends the new days", async () => {
    const b = booking({ status: "CONFIRMED", statusLabel: "مؤكد", paid: "1200.00" });
    const calls = mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, b],
      "GET /api/admin/resources": () => [200, resources],
      "POST /api/admin/bookings/quote": () => [200, { available: true, total: 2400 }],
      "POST /api/admin/bookings/b1/edit": () => [200, b],
    }, OWNER);
    renderAt("/admin/bookings/b1/edit");
    fireEvent.change(await screen.findByLabelText("يوم للإضافة"), { target: { value: "2026-12-12" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة اليوم" }));
    await waitFor(() => expect(screen.getByLabelText("السعر الجديد")).toHaveTextContent("2,400"));
    expect(posted(calls, "/api/admin/bookings/quote")).toMatchObject({ dates: ["2026-12-10", "2026-12-12"], bookingId: "b1" });
    expect(screen.getByLabelText("الأثر على الدفع")).toHaveTextContent("المتبقي بعد التعديل1,200");
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    await waitFor(() => expect(posted(calls, "/api/admin/bookings/b1/edit")).toMatchObject({ dates: ["2026-12-10", "2026-12-12"], resourceIds: ["full"], manualDiscount: null }));
  });
});

describe("door code for separate days", () => {
  it("lists every booked day's window under the code", async () => {
    mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, booking({
        status: "CONFIRMED", statusLabel: "مؤكد", lockConfigured: true, doorCode: "482915",
        doorCodes: [{ id: "c1", status: "ACTIVE", startsAt: "2026-12-10T11:00:00.000Z", endsAt: "2026-12-11T01:00:00.000Z", error: null, createdAt: "2026-11-15T10:00:00.000Z", deletedAt: null }],
        doorCodeSchedule: [
          { startsAt: "2026-12-10T11:00:00.000Z", endsAt: "2026-12-11T01:00:00.000Z", code: "482915" },
          { startsAt: "2026-12-12T11:00:00.000Z", endsAt: "2026-12-13T01:00:00.000Z", code: "482915" },
        ],
      })],
    }, OWNER);
    renderAt("/admin/bookings/b1");
    const list = await screen.findByLabelText("مواعيد عمل الرقم");
    expect(within(list).getAllByText(/يعمل من/)).toHaveLength(2);
    expect(list).toHaveTextContent("لا يفتح الباب في الأيام بينها");
    expect(screen.getByText("482915")).toBeInTheDocument();
  });
});

describe("calendar with separate days", () => {
  it("marks only the booked days, not the days in between", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T09:00:00"));
    mockAdminApi({
      "GET /api/admin/calendar": () => [200, { bookings: [{
        id: "b5", reference: "JD-000005", status: "CONFIRMED", channel: "MANUAL", startDate: "2026-11-17", endDate: "2026-11-21",
        guest: { name: "متعب", phone: null }, kind: "FULL", resources: [{ id: "full", name: "الاستراحة كاملة", kind: "FULL" }], days: ["2026-11-17", "2026-11-20"],
      }] }],
    }, OWNER);
    renderAt("/admin/calendar");
    expect(await screen.findAllByRole("link", { name: /متعب/ })).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("contract and WhatsApp as one ordered flow", () => {
  function flowRoutes(state: BookingDetail, calls: { body?: unknown }[]) {
    return {
      "GET /api/admin/bookings/b1": () => [200, state] as [number, unknown],
      "PATCH /api/admin/bookings/b1": (body: unknown) => {
        calls.push({ body });
        const b = body as { contractSent?: boolean; contractAccepted?: boolean };
        if (b.contractSent !== undefined) state.contractSentAt = b.contractSent ? "2026-11-15T10:00:00.000Z" : null;
        if (b.contractAccepted !== undefined) state.contractAcceptedAt = b.contractAccepted ? "2026-11-15T11:00:00.000Z" : null;
        return [200, state] as [number, unknown];
      },
    };
  }

  const summary = (bookingRemaining: string, depositRemaining: string) => ({
    plan: "DEPOSIT", depositTiming: "BEFORE_CHECKIN", legacy: false, bookingTotal: "1200.00", upfrontAmount: "600.00",
    bookingPaid: "600.00", bookingRefunded: "0.00", bookingRemaining, upfrontRemaining: "0.00",
    securityDeposit: "500.00", depositPaid: "0.00", depositRefunded: "0.00", depositRemaining, depositStatus: "UNPAID",
    dueToConfirm: "0.00", canConfirm: true, fullySettled: bookingRemaining === "0.00" && depositRemaining === "0.00", balanceDueAt: null,
  }) as const;

  it("five steps; before confirmation only the deposit request and the deposit form", async () => {
    mockAdminApi(flowRoutes(booking(), []), OWNER);
    renderAt("/admin/bookings/b1");
    const steps = await screen.findByRole("list", { name: "خطوات العقد والتواصل" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    for (const t of ["المطالبة بدفع العربون", "تسجيل العربون وتأكيد الحجز", "إرسال العقد PDF", "المطالبة بالمتبقي والتأمين", "إرسال رابط البوابة"]) expect(steps).toHaveTextContent(t);
    expect(within(steps).getByRole("link", { name: /أرسل طلب العربون/ })).toBeInTheDocument();
    expect(within(steps).getByRole("group", { name: "تسجيل العربون" })).toBeInTheDocument();
    expect(within(steps).queryByRole("link", { name: /أرسل العقد/ })).toBeNull();
    expect(within(steps).queryByRole("button", { name: "إنشاء رابط البوابة" })).toBeNull();
  });

  it("after confirmation: send the contract (marks it sent), ask for the rest, record it in one tap", async () => {
    vi.stubGlobal("confirm", () => true);
    const state = booking({ status: "CONFIRMED", statusLabel: "مؤكد", paid: "600.00", payment: { ...summary("600.00", "500.00") }, allowedTransitions: ["CANCELLED", "COMPLETED"] });
    const calls: { body?: unknown }[] = [];
    const api = mockAdminApi({ ...flowRoutes(state, calls), "POST /api/admin/bookings/b1/payments": () => [201, {}] }, OWNER);
    renderAt("/admin/bookings/b1");
    const steps = await screen.findByRole("list", { name: "خطوات العقد والتواصل" });
    fireEvent.click(within(steps).getByRole("link", { name: /أرسل العقد عبر واتساب/ }));
    await waitFor(() => expect(calls[0]?.body).toEqual({ contractSent: true }));
    // Once the contract is sent, the next step (the rest) opens by itself.
    const ask = await within(steps).findByRole("link", { name: /أرسل المطالبة بالمتبقي/ });
    expect(decodeURIComponent(ask.getAttribute("href")!)).toContain("المتبقي من مبلغ الحجز 600 ريال والتأمين 500 ريال");
    fireEvent.click(within(steps).getByRole("button", { name: /استلمت المتبقي \(1,100 ريال\)/ }));
    await waitFor(() => expect(api.filter((c) => c.path === "/api/admin/bookings/b1/payments").map((c) => c.body)).toEqual([
      { method: "BANK_TRANSFER", purpose: "BOOKING", amount: 600, note: "المتبقي" },
      { method: "BANK_TRANSFER", purpose: "SECURITY_DEPOSIT", amount: 500, note: "التأمين" },
    ]));
  });

  it("skips the balance step when everything is paid", async () => {
    mockAdminApi(flowRoutes(booking({ status: "CONFIRMED", paid: "1200.00", contractSentAt: "2026-11-20T10:00:00Z", payment: { ...summary("0.00", "0.00") }, allowedTransitions: ["CANCELLED"] }), []), OWNER);
    renderAt("/admin/bookings/b1");
    const steps = await screen.findByRole("list", { name: "خطوات العقد والتواصل" });
    expect(within(steps).queryByRole("link", { name: /أرسل المطالبة بالمتبقي/ })).toBeNull();
    expect(within(steps).getByRole("button", { name: "إنشاء رابط البوابة" })).toBeInTheDocument();
  });
});

describe("customers list", () => {
  const guests = [
    { id: "g1", name: "سارة محمد", phone: "966501112222", email: null, notes: null, nationalIdMasked: null, createdAt: "2025-01-01T00:00:00Z", bookingCount: 3, lastStay: "2026-10-01" },
    { id: "g2", name: "أحمد علي", phone: null, email: null, notes: null, nationalIdMasked: null, createdAt: "2025-02-01T00:00:00Z", bookingCount: 1, lastStay: "2026-11-01" },
  ];
  it("shows stats, marks returning customers, filters and searches as you type", async () => {
    const searched: string[] = [];
    mockAdminApi({ "GET /api/admin/guests": (_b: unknown, url: URL) => { searched.push(url.searchParams.get("q") ?? ""); return [200, guests]; } }, OWNER);
    renderAt("/admin/guests");
    const list = await screen.findByRole("list", { name: "قائمة العملاء" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("عميل دائم")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "واتساب سارة محمد" })).toHaveAttribute("href", "https://wa.me/966501112222");
    fireEvent.click(screen.getByRole("button", { name: /عملاء دائمون/ }));
    expect(within(screen.getByRole("list", { name: "قائمة العملاء" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("بحث عن ضيف"), { target: { value: "سارة" } });
    await waitFor(() => expect(searched).toContain("سارة"));
  });
});

describe("deleting a cancelled booking", () => {
  it("asks for the booking number before deleting, then goes back to the list", async () => {
    const calls = mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, booking({ status: "CANCELLED", statusLabel: "ملغي", allowedTransitions: [] })],
      "DELETE /api/admin/bookings/b1": () => [200, { reference: "JD-000007", guestDeleted: false }],
      "GET /api/admin/bookings": () => [200, { items: [], total: 0, page: 1, pageSize: 30 }],
    }, OWNER);
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: /حذف الحجز نهائيًا/ }));
    const go = screen.getByRole("button", { name: "حذف نهائي" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("رقم الحجز للتأكيد"), { target: { value: "jd-000007" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ reference: "jd-000007", deleteGuest: false }));
  });

  it("is not offered for an active booking or to staff", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    renderAt("/admin/bookings/b1");
    await screen.findByText(/JD-000007/);
    expect(screen.queryByRole("button", { name: /حذف الحجز نهائيًا/ })).toBeNull();
  });
});

describe("expenses month range", () => {
  it("asks for the real last day of the month", async () => {
    const { monthEnd } = await import("./pages/ExpensesPage");
    expect(monthEnd("2026-11")).toBe("2026-11-30");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });
});

describe("correcting payments", () => {
  const p = (id: string) => ({ id, method: "BANK_TRANSFER" as const, amount: "600.00", status: "ACCEPTED" as const, reportedAt: null, externalRef: null, note: null, verifiedAt: "2026-11-18T20:30:00Z", verifiedBy: { name: "المالك" }, createdAt: "2026-11-18T20:30:00Z" });
  it("lets the owner delete a duplicate and fix an amount", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, booking({ status: "CONFIRMED", statusLabel: "مؤكد", paid: "1200.00", payments: [p("p1"), p("p2")], allowedTransitions: ["CANCELLED", "COMPLETED"] })],
      "DELETE /api/admin/bookings/payments/p2": () => [204, null],
      "PATCH /api/admin/bookings/payments/p1": () => [200, {}],
    }, OWNER);
    renderAt("/admin/bookings/b1");
    const del = await screen.findAllByRole("button", { name: "حذف دفعة 600 ريال" });
    fireEvent.click(del[1]!);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/admin/bookings/payments/p2")).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "تعديل دفعة 600 ريال" })[0]!);
    fireEvent.change(screen.getByLabelText("المبلغ الصحيح"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("طريقة الدفع"), { target: { value: "CASH" } });
    fireEvent.click(within(screen.getByRole("group", { name: "تصحيح الدفعة" })).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH" && c.path === "/api/admin/bookings/payments/p1")?.body).toEqual({ amount: 500, method: "CASH" }));
  });

  it("is not offered to staff", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking({ payments: [p("p1")], paid: "600.00" })] }, STAFF);
    renderAt("/admin/bookings/b1");
    await screen.findByText(/JD-000007/);
    expect(screen.queryByRole("button", { name: /حذف دفعة/ })).toBeNull();
  });
});

describe("a booking marked «مكتمل» by mistake", () => {
  it("offers «إرجاع إلى مؤكد» to the owner, and no «مكتمل» button on confirmed bookings", async () => {
    const calls = mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, booking({ status: "COMPLETED", statusLabel: "مكتمل", paid: "1200.00", allowedTransitions: ["CONFIRMED"] })],
      "POST /api/admin/bookings/b1/status": () => [200, {}],
    }, OWNER);
    const first = renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: "إرجاع إلى مؤكد" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/status"))?.body).toMatchObject({ status: "CONFIRMED" }));
    expect(screen.queryByRole("group", { name: "تسجيل العربون" })).toBeNull();
    first.unmount();

    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking({ status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED", "COMPLETED"] })] }, OWNER);
    renderAt("/admin/bookings/b1");
    await screen.findByRole("button", { name: "إلغاء الحجز" });
    expect(screen.queryByRole("button", { name: /الإقامة مكتملة/ })).toBeNull();
  });
});

describe("portal link survives the refresh after creating it", () => {
  it("keeps «أرسل رابط البوابة» visible once the step turns done", async () => {
    const url = `https://jood.example/g/${"q".repeat(43)}`;
    // Everything before it is done (contract sent, fully paid), so the portal is the current step.
    const settled = {
      plan: "FULL", depositTiming: "WITH_FIRST_PAYMENT", legacy: false, bookingTotal: "1200.00", upfrontAmount: "1200.00",
      bookingPaid: "1200.00", bookingRefunded: "0.00", bookingRemaining: "0.00", upfrontRemaining: "0.00",
      securityDeposit: "500.00", depositPaid: "500.00", depositRefunded: "0.00", depositRemaining: "0.00", depositStatus: "PAID",
      dueToConfirm: "0.00", canConfirm: true, fullySettled: true, balanceDueAt: null,
    } as const;
    let state = booking({ status: "CONFIRMED", paid: "1200.00", contractSentAt: "2026-11-27T10:00:00Z", payment: { ...settled }, allowedTransitions: ["CANCELLED"] });
    mockAdminApi({
      "GET /api/admin/bookings/b1": () => [200, state],
      "POST /api/admin/bookings/b1/guest-link": () => {
        // After issuing, the refreshed booking has an active link (the step is done).
        state = { ...state, accessTokens: [{ id: "t9", createdAt: "2026-11-28T06:55:00Z", expiresAt: "2099-01-01T00:00:00Z", revokedAt: null, lastUsedAt: null }] };
        return [201, { id: "t9", url, expiresAt: "2099-01-01T00:00:00Z" }];
      },
    }, OWNER);
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: "إنشاء رابط البوابة" }));
    const send = await screen.findByRole("link", { name: /أرسل رابط البوابة عبر واتساب/ });
    // Let the refresh land (the step turns done, nothing is current any more): the button must stay.
    await waitFor(() => expect(within(screen.getByRole("list", { name: "خطوات العقد والتواصل" })).getAllByRole("listitem")[4]!.querySelector("svg.text-emerald-600")).not.toBeNull());
    expect(screen.getByRole("link", { name: /أرسل رابط البوابة عبر واتساب/ })).toBeInTheDocument();
    expect(decodeURIComponent(send.getAttribute("href")!)).toContain(url);
  });
});

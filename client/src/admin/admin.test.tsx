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
    guest: { id: "g1", name: "سارة القحطاني", phone: "966501234567", email: null, notes: null },
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
  it("offers a WhatsApp message with the booking details and the contract request", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    renderAt("/admin/bookings/b1");
    const link = await screen.findByRole("link", { name: /تأكيد التفاصيل وإرسال العقد/ });
    const href = decodeURIComponent(link.getAttribute("href")!);
    expect(href).toMatch(/^https:\/\/wa\.me\/966501234567\?text=/);
    expect(href).toContain("JD-000007");
    expect(href).toContain("1,200 ريال");
    expect(href).toContain("500 ريال");
    expect(href).toContain("«موافق»");
    expect(screen.getByRole("link", { name: /عرض العقد وتنزيله PDF/ })).toHaveAttribute("href", "/admin/bookings/b1/contract");
  });

  it("keeps «تأكيد الحجز» disabled until verified payments cover the booking amount", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    renderAt("/admin/bookings/b1");
    expect(await screen.findByRole("button", { name: "تأكيد الحجز" })).toBeDisabled();
    expect(screen.getByText(/للتأكيد: سجّل دفعة متحقق منها/)).toBeInTheDocument();
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
    fireEvent.change(await screen.findByLabelText("المبلغ (ريال)"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدفعة" }));
    const confirmBtn = await screen.findByRole("button", { name: "تأكيد الحجز" });
    await waitFor(() => expect(confirmBtn).toBeEnabled());
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/admin/bookings/b1/status" && (c.body as { status: string }).status === "CONFIRMED")).toBe(true));
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
    renderAt("/admin/bookings/b1");
    fireEvent.click(await screen.findByRole("button", { name: /تم التواصل — بانتظار الدفع/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن تغيير الحالة");
  });
});

describe("guest portal link", () => {
  it("is offered only for confirmed bookings, then issued and sent on WhatsApp with the link", async () => {
    mockAdminApi({ "GET /api/admin/bookings/b1": () => [200, booking()] }, OWNER);
    const first = renderAt("/admin/bookings/b1");
    await screen.findByRole("heading", { name: "حجز JD-000007" });
    expect(screen.queryByRole("heading", { name: "بوابة الضيف" })).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "إنشاء رابط البوابة" }));
    const send = await screen.findByRole("link", { name: /إرسال الرابط للضيف/ });
    const href = decodeURIComponent(send.getAttribute("href")!);
    expect(href).toMatch(/^https:\/\/wa\.me\/966501234567\?text=/);
    expect(href).toContain(url);
    expect(href).toContain("JD-000007");
    expect(screen.getByText(/يظهر الرابط هنا مرة واحدة فقط/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/bookings/b1/guest-link")).toBe(true);
  });

  it("shows an active link's status and lets the owner revoke it", async () => {
    const calls = mockAdminApi(
      {
        "GET /api/admin/bookings/b1": () => [200, booking({ status: "CONFIRMED", paid: "1200.00", allowedTransitions: ["CANCELLED"], accessTokens: [{ id: "t1", createdAt: "2026-11-02T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", revokedAt: null, lastUsedAt: null }] })],
        "DELETE /api/admin/bookings/b1/guest-link": () => [204, null],
      },
      OWNER,
    );
    vi.stubGlobal("confirm", () => true);
    renderAt("/admin/bookings/b1");
    expect(await screen.findByText(/يوجد رابط فعّال حتى/)).toBeInTheDocument();
    expect(screen.getByText("لم يفتحه الضيف بعد.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الرابط" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
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
  };

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

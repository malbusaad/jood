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

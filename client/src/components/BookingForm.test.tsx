import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../test/render";
import type { BookingOption, BookingReceipt } from "../content/types";

const FULL: BookingOption = { id: "full", name: "الاستراحة كاملة", kind: "FULL", description: null, amenities: [], available: true, total: 1200, reason: null };
const MAJLIS: BookingOption = { id: "majlis", name: "المجلس", kind: "PART", description: null, amenities: ["المجلس", "المطبخ"], available: true, total: 400, reason: null };
const TENT: BookingOption = { id: "tent", name: "الخيمة", kind: "PART", description: null, amenities: ["الخيمة الأرضية"], available: false, total: null, reason: "الخيمة محجوز يوم الخميس" };

const receipt: BookingReceipt = {
  reference: "JD-000042",
  status: "NEW",
  startDate: "2026-11-12",
  endDate: "2026-11-13",
  items: ["الاستراحة كاملة"],
  lines: [{ date: "2026-11-12", resourceId: "full", resourceName: "الاستراحة كاملة", price: "1200.00" }],
  total: 1200,
  deposit: 500,
  payable: 1700,
  bank: { bankName: "بنك الاختبار", accountHolder: "استراحة الجود", iban: "SA0380000000608010167519", instructions: null },
};

describe("booking form", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10, 12)); // Tue 10 Nov 2026
  });
  afterEach(() => vi.useRealTimers());

  async function pickThursday() {
    const day = await screen.findByRole("button", { name: /12 نوفمبر 2026/ });
    fireEvent.click(day);
  }

  it("walks through date → selection → server price → details → receipt with bank details", async () => {
    const { fetchMock } = renderApp("/booking", { options: [FULL, MAJLIS, TENT], booking: { status: 201, body: receipt } });
    await pickThursday();

    expect(await screen.findByRole("radio", { name: /الاستراحة كاملة/ })).toBeChecked();
    expect(await screen.findByText("الإجمالي المستحق")).toBeInTheDocument();
    expect(screen.getByText("1,700 ريال")).toBeInTheDocument(); // 1,200 + 500 deposit

    const submit = screen.getByRole("button", { name: "إرسال طلب الحجز" });
    expect(submit).toBeDisabled(); // name, ID, phone and terms required
    fireEvent.change(screen.getByLabelText("الاسم الثلاثي"), { target: { value: "سارة القحطاني" } });
    fireEvent.change(screen.getByLabelText(/رقم الهوية أو الإقامة/), { target: { value: "1023456789" } });
    fireEvent.change(screen.getByLabelText("رقم الجوال (واتساب)"), { target: { value: "0501234567" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /أوافق عليها/ }));
    expect(submit).toBeDisabled(); // two-part name is not enough
    fireEvent.click(screen.getByRole("checkbox", { name: /أوافق عليها/ }));
    fireEvent.change(screen.getByLabelText("الاسم الثلاثي"), { target: { value: "سارة محمد القحطاني" } });
    fireEvent.change(screen.getByLabelText(/رقم الهوية أو الإقامة/), { target: { value: "1023456789" } });
    fireEvent.change(screen.getByLabelText("رقم الجوال (واتساب)"), { target: { value: "0501234567" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /أوافق عليها/ }));
    expect(screen.getByText(/هذا طلب حجز وليس حجزًا مؤكدًا/)).toBeInTheDocument();
    fireEvent.click(submit);

    expect(await screen.findByRole("heading", { name: "تم استلام طلب الحجز" })).toBeInTheDocument();
    expect(screen.getByText("JD-000042")).toBeInTheDocument();
    expect(screen.getByText(/سنتواصل معك قريبًا عبر واتساب/)).toBeInTheDocument();
    expect(screen.getByText("SA0380000000608010167519")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نسخ الآيبان" })).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([u]) => String(u) === "/api/public/bookings")!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body).toMatchObject({ resourceIds: ["full"], startDate: "2026-11-12", nights: 1, name: "سارة محمد القحطاني", nationalId: "1023456789", phone: "0501234567", acceptTerms: true, website: "" });
    expect(body.total).toBeUndefined(); // the browser never sends a price
  });

  it("lets the guest pick available parts and shows why others are unavailable", async () => {
    renderApp("/booking", { options: [{ ...FULL, available: false, total: null, reason: "محجوز" }, MAJLIS, TENT] });
    await pickThursday();
    const parts = await screen.findByRole("radio", { name: /أجزاء من الاستراحة/ });
    expect(parts).toBeChecked(); // full house unavailable → parts mode
    expect(screen.getByRole("radio", { name: /الاستراحة كاملة/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /الخيمة/ })).toBeDisabled();
    expect(screen.getByText(/الخيمة محجوز يوم الخميس/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /المجلس/ }));
    expect(await screen.findByText("900 ريال")).toBeInTheDocument(); // 400 + 500 deposit
  });

  it("shows the server's message when the date was just taken", async () => {
    renderApp("/booking", { options: [FULL], booking: { status: 409, body: { error: "عذرًا، حُجز هذا الموعد للتو. اختر تاريخًا آخر." } } });
    await pickThursday();
    await screen.findByText("الإجمالي المستحق");
    fireEvent.change(screen.getByLabelText("الاسم الثلاثي"), { target: { value: "سارة محمد القحطاني" } });
    fireEvent.change(screen.getByLabelText(/رقم الهوية أو الإقامة/), { target: { value: "1023456789" } });
    fireEvent.change(screen.getByLabelText("رقم الجوال (واتساب)"), { target: { value: "0501234567" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /أوافق عليها/ }));
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الحجز" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("حُجز هذا الموعد للتو");
  });

  it("does not show bank details anywhere before a request is sent", async () => {
    renderApp("/booking", { options: [FULL] });
    await pickThursday();
    await screen.findByText("الإجمالي المستحق");
    await waitFor(() => expect(within(screen.getByRole("main")).queryByText(/SA\d{22}/)).toBeNull());
  });

  it("applies a discount code checked by the server, and sends only the accepted code", async () => {
    const { fetchMock } = renderApp("/booking", { options: [FULL], booking: { status: 201, body: { ...receipt, subtotal: 1200, discount: { code: "JOOD10", amount: 120 }, total: 1080, payable: 1580 } } });
    await pickThursday();
    expect(await screen.findByText("1,700 ريال")).toBeInTheDocument();

    const field = screen.getByLabelText("كود الخصم (اختياري)");
    fireEvent.change(field, { target: { value: "WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("كود الخصم غير صحيح أو غير مفعّل");
    expect(screen.getByText("1,700 ريال")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "jood10" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق" }));
    expect(await screen.findByText("تم تطبيق الخصم. التأمين لا يدخل في الخصم.")).toBeInTheDocument();
    expect(screen.getByText("مبلغ الحجز قبل الخصم")).toBeInTheDocument();
    expect(screen.getByText("− 120 ريال")).toBeInTheDocument();
    expect(screen.getByText("1,080 ريال")).toBeInTheDocument();
    expect(screen.getByText("1,580 ريال")).toBeInTheDocument(); // 1,080 + 500 deposit (not discounted)

    fireEvent.change(screen.getByLabelText("الاسم الثلاثي"), { target: { value: "سارة محمد القحطاني" } });
    fireEvent.change(screen.getByLabelText(/رقم الهوية أو الإقامة/), { target: { value: "1023456789" } });
    fireEvent.change(screen.getByLabelText("رقم الجوال (واتساب)"), { target: { value: "0501234567" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /أوافق عليها/ }));
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الحجز" }));
    expect(await screen.findByRole("heading", { name: "تم استلام طلب الحجز" })).toBeInTheDocument();
    const sent = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/public/bookings"))!;
    const body = JSON.parse(String(sent[1]!.body));
    expect(body.discountCode).toBe("JOOD10");
    expect(body).not.toHaveProperty("discountAmount");
    expect(body).not.toHaveProperty("total");
    expect(screen.getByText("− 120 ريال")).toBeInTheDocument(); // on the receipt too
  });
});

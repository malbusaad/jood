import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { db, fullResource, makeApp, resetDb, signedIn } from "./helpers.js";
import { addDays, dayOfWeek, todayInRiyadh } from "../src/lib/dates.js";
import { makeSecretBox } from "../src/lib/secretBox.js";

const box = makeSecretBox("test-secret-test-secret-test-secret-1", "door-codes");
const app = makeApp({ secretBox: box, bookingLimit: 1000 });
const today = todayInRiyadh();
const past = (n: number) => addDays(today, -n);
const future = (() => {
  let d = addDays(today, 10);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
})();

const BOOKING_HEADERS = ["رقم الحجز", "اسم المستأجر", "رقم الجوال", "رقم الهوية / الإقامة", "حالة الحجز", "التصنيف الزمني", "التاريخ الرئيسي", "الأيام الإضافية", "عدد الأيام", "آخر يوم للحجز", "إجمالي مبلغ الحجز (ر.س)", "العربون المسجل (ر.س)", "المدفوع المسجل (ر.س)", "المتبقي المسجل (ر.س)", "المتبقي حسب العربون (ر.س)", "ملاحظات", "تاريخ إنشاء السجل (الرياض)", "آخر تعديل (الرياض)"];
const EXPENSE_HEADERS = ["رقم المصروف", "البند / الوصف", "التصنيف", "تاريخ المصروف", "المبلغ (ر.س)", "ملاحظات", "تاريخ إنشاء السجل (الرياض)", "آخر تعديل (الرياض)"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A small made-up workbook with the same layout as the owner's export (title rows, then a header row from column B). */
async function workbook(extraBookings: unknown[][] = []) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("الملخص").addRow([null, "ملخص"]);
  const b = wb.addWorksheet("جميع الحجوزات");
  b.addRow([]);
  b.addRow([null, "جميع الحجوزات — السجل الكامل"]);
  b.addRow([]);
  b.addRow([null, ...BOOKING_HEADERS]);
  const rows: unknown[][] = [
    // ref, name, phone, id, status, cat, main date, extra days, days, last, total, deposit, paid, remaining, rem2, notes, created
    ["101", "ضيف سابق أول", "‪0551112222‬", "1012345678", "مؤكد", "سابق", d(past(30)), null, 1, null, 800, 0, null, null, null, null, "2026-04-13 12:24:02"],
    ["102", "ضيف سابق أول", "0551112222", null, "مؤكد", "سابق", d(past(20)), `${past(13)}\n${past(6)}`, 3, null, 1500, 300, 100, null, null, "ملاحظة قديمة", null],
    ["103", "ضيف بلا جوال", null, null, "مؤكد", "سابق", d(past(15)), null, 1, null, 700, 0, null, null, null, null, null],
    ["104", "ضيف بلا جوال", null, null, "مؤكد", "سابق", d(past(8)), null, 1, null, 650, 0, null, null, null, null, null],
    ["105", "طلب معلق قديم", "0553334444", null, "معلق", "سابق", d(past(40)), null, 1, null, 0, 0, null, null, null, null, null],
    ["106", "ضيف قادم", "0555556666", null, "مؤكد", "قادم", d(future), null, 1, null, 900, 450, null, null, null, null, null],
    ...extraBookings,
  ];
  for (const r of rows) b.addRow([null, ...r]);
  const e = wb.addWorksheet("المصاريف");
  e.addRow([]);
  e.addRow([null, "جميع المصاريف المسجلة"]);
  e.addRow([null, ...EXPENSE_HEADERS]);
  e.addRow([null, "1", "فاتورة الكهرباء", "أخرى", d(past(30)), 190, null, null]);
  e.addRow([null, "2", "التنظيف", "أخرى", d(past(2)), 2000.5, "شهري", null]);
  e.addRow([null, "3", "راتب العامل", "رواتب", d(past(2)), 1500, null, null]);
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(await wb.xlsx.writeBuffer()).toString("base64")}`;
}

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe("importing the previous records", () => {
  it("previews without saving anything", async () => {
    const { agent } = await signedIn(app);
    const r = await agent.post("/api/admin/import/preview").send({ data: await workbook() });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({
      bookings: 6,
      byStatus: { COMPLETED: 4, EXPIRED: 1, CONFIRMED: 1 },
      expenses: 3,
      expensesTotal: 3690.5,
      bookingValueConfirmed: 800 + 1500 + 700 + 650 + 900,
      received: 300 + 450, // the larger of «العربون» and «المدفوع» per booking
      newCustomers: 4,
    });
    expect(r.body.summary.upcoming).toEqual([{ ref: "106", name: "ضيف قادم", dates: [future], total: 900, received: 450, status: "CONFIRMED" }]);
    expect(await db.booking.count()).toBe(0);
    expect(await db.expense.count()).toBe(0);
  });

  it("imports customers, bookings, amounts received and expenses — once", async () => {
    const { agent } = await signedIn(app);
    const file = await workbook();
    const r = await agent.post("/api/admin/import/commit").send({ data: file });
    expect(r.status).toBe(200);

    const bookings = await db.booking.findMany({ include: { guest: true, items: true, payments: true, locks: true }, orderBy: { reference: "asc" } });
    expect(bookings.map((b) => [b.reference, b.status, b.channel])).toEqual([
      ["OLD-101", "COMPLETED", "IMPORTED"],
      ["OLD-102", "COMPLETED", "IMPORTED"],
      ["OLD-103", "COMPLETED", "IMPORTED"],
      ["OLD-104", "COMPLETED", "IMPORTED"],
      ["OLD-105", "EXPIRED", "IMPORTED"],
      ["OLD-106", "CONFIRMED", "IMPORTED"],
    ]);
    const [b101, b102, b103, b104, , b106] = bookings;
    // Same phone (with hidden direction marks) → same customer; the ID is stored encrypted.
    expect(b101!.guestId).toBe(b102!.guestId);
    expect(b101!.guest.phone).toBe("966551112222");
    expect(b101!.guest.nationalIdLast4).toBe("5678");
    expect(b101!.guest.nationalIdEnc).not.toContain("1012345678");
    // No phone: the same name is the same customer.
    expect(b103!.guestId).toBe(b104!.guestId);
    expect(b103!.guest.phone).toBeNull();
    // Separate days kept as one booking with its days; the amount is split without losing a riyal.
    expect(b102!.items.map((i) => i.price.toFixed(2))).toEqual(["500.00", "500.00", "500.00"]);
    expect(b102!.totalAmount.toFixed(2)).toBe("1500.00");
    expect(b102!.adminNotes).toContain("رقم الحجز 102");
    expect(b102!.adminNotes).toContain("ملاحظة قديمة");
    // Money received recorded as verified booking payments (never more than the booking amount).
    expect(b102!.payments.map((p) => [p.amount.toFixed(2), p.purpose, p.status])).toEqual([["300.00", "BOOKING", "ACCEPTED"]]);
    expect(b106!.payments[0]!.amount.toFixed(2)).toBe("450.00");
    expect(b101!.payments).toHaveLength(0); // nothing recorded → nothing invented
    expect(b101!.createdAt.toISOString()).toBe("2026-04-13T09:24:02.000Z"); // Riyadh time kept
    // Only the upcoming booking holds its day; old ones do not touch the calendar.
    expect(b106!.locks.length).toBeGreaterThan(0);
    expect(bookings.filter((b) => b.reference !== "OLD-106").every((b) => b.locks.length === 0)).toBe(true);
    // Old bookings keep the old payment rules; no WhatsApp messages are queued for imports.
    expect(bookings.every((b) => b.legacyPayment)).toBe(true);
    expect(await db.whatsAppMessage.count()).toBe(0);

    const expenses = await db.expense.findMany({ orderBy: { externalRef: "asc" } });
    expect(expenses.map((e) => [e.externalRef, e.title, e.amount.toFixed(2)])).toEqual([
      ["IMP-1", "فاتورة الكهرباء", "190.00"],
      ["IMP-2", "التنظيف", "2000.50"],
      ["IMP-3", "راتب العامل", "1500.00"],
    ]);

    // The audit log keeps counts only — no names or phone numbers.
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "import.commit" } });
    expect(log.details).toEqual({ bookings: 6, expenses: 3 });

    // Uploading the same file again adds nothing.
    const again = await agent.post("/api/admin/import/commit").send({ data: file });
    expect(again.status).toBe(409);
    expect((await agent.post("/api/admin/import/preview").send({ data: file })).body.summary).toMatchObject({ bookings: 0, skippedExisting: 6, expenses: 0, skippedExpenses: 3 });
    expect(await db.booking.count()).toBe(6);
  });

  it("the imported upcoming day is closed on the website", async () => {
    const { agent } = await signedIn(app);
    await agent.post("/api/admin/import/commit").send({ data: await workbook() }).expect(200);
    const full = await fullResource();
    const r = await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: future, nights: 1, name: "ضيف جديد من الموقع", nationalId: "1023456789", phone: "0500000001", acceptTerms: true });
    expect(r.status).toBe(409);
  });

  it("never double-books: an upcoming record on a day already booked on the site is left out and reported", async () => {
    const { agent } = await signedIn(app);
    const full = await fullResource();
    await request(app).post("/api/public/bookings").send({ resourceIds: [full.id], startDate: future, nights: 1, name: "ضيف الموقع الأول", nationalId: "1023456789", phone: "0500000001", acceptTerms: true }).expect(201);
    const p = (await agent.post("/api/admin/import/preview").send({ data: await workbook() })).body;
    expect(p.summary.bookings).toBe(5);
    expect(p.issues.join(" ")).toMatch(/الحجز 106 .* يتعارض مع حجز موجود/);
  });

  it("links to an existing customer by phone without changing their name", async () => {
    const { agent } = await signedIn(app);
    await db.guest.create({ data: { name: "الاسم في الموقع", phone: "966551112222" } });
    expect((await agent.post("/api/admin/import/preview").send({ data: await workbook() })).body.summary).toMatchObject({ newCustomers: 3, existingCustomers: 1 });
    await agent.post("/api/admin/import/commit").send({ data: await workbook() }).expect(200);
    expect(await db.guest.count({ where: { phone: "966551112222" } })).toBe(1);
    expect((await db.guest.findUniqueOrThrow({ where: { phone: "966551112222" } })).name).toBe("الاسم في الموقع");
  });

  it("reports rows it cannot read, refuses other files, and is owner-only", async () => {
    const { agent } = await signedIn(app);
    const p = (await agent.post("/api/admin/import/preview").send({ data: await workbook([["107", "", null, null, "مؤكد", null, null, null, 1, null, null, null, null, null, null, null, null]]) })).body;
    expect(p.issues).toContain("الحجز 107: بيانات ناقصة (الاسم أو التاريخ أو المبلغ أو الحالة) — لن يُستورد");
    expect((await agent.post("/api/admin/import/preview").send({ data: Buffer.from("not a spreadsheet at all, just text............................................................................").toString("base64") })).status).toBe(400);
    const staff = (await signedIn(app, "STAFF")).agent;
    expect((await staff.post("/api/admin/import/preview").send({ data: await workbook() })).status).toBe(403);
  });
});

describe("expenses and the monthly report", () => {
  it("records, edits, filters and deletes expenses", async () => {
    const { agent } = await signedIn(app);
    const a = await agent.post("/api/admin/expenses").send({ title: "صيانة المكيف", category: "صيانة", date: "2026-05-10", amount: 350 });
    expect(a.status).toBe(201);
    await agent.post("/api/admin/expenses").send({ title: "فاتورة الماء", category: "كهرباء ومياه", date: "2026-06-02", amount: 120.5 }).expect(201);
    expect((await agent.post("/api/admin/expenses").send({ title: "x", category: "أخرى", date: "2026-06-02", amount: 0 })).status).toBe(400);
    const may = (await agent.get("/api/admin/expenses?from=2026-05-01&to=2026-05-31")).body;
    expect(may).toMatchObject({ total: 350, items: [{ title: "صيانة المكيف", amount: 350, date: "2026-05-10" }] });
    expect(may.categories).toContain("رواتب");
    await agent.put(`/api/admin/expenses/${a.body.id}`).send({ title: "صيانة المكيف", category: "صيانة", date: "2026-05-10", amount: 400 }).expect(200);
    expect((await agent.get("/api/admin/expenses?category=صيانة")).body.total).toBe(400);
    await agent.delete(`/api/admin/expenses/${a.body.id}`).expect(204);
    expect((await agent.get("/api/admin/expenses")).body.items).toHaveLength(1);
    expect((await (await signedIn(app, "STAFF")).agent.get("/api/admin/expenses")).status).toBe(403);
  });

  it("shows booking value, money collected, expenses and net by month", async () => {
    const { agent } = await signedIn(app);
    await agent.post("/api/admin/import/commit").send({ data: await workbook() }).expect(200);
    const year = Number(today.slice(0, 4));
    const r = (await agent.get(`/api/admin/reports/monthly?year=${year}`)).body;
    const all = await db.booking.findMany({ where: { status: { in: ["CONFIRMED", "COMPLETED"] } } });
    const inYear = all.filter((b) => b.startDate.getUTCFullYear() === year).reduce((s, b) => s + Number(b.totalAmount), 0);
    expect(r.total.bookingValue).toBe(inYear);
    expect(r.months).toHaveLength(12);
    expect(r.byCategory.رواتب).toBe(1500);
    expect(r.total.net).toBe(Math.round((r.total.bookingValue - r.total.expenses) * 100) / 100);
  });
});

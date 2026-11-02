import type { ReactNode } from "react";
import { Card, Empty, ErrorNote, Loading, PageTitle, dateTime, useApi } from "../ui";

interface Log { id: string; action: string; entityType: string; entityId: string | null; details: unknown; ip: string | null; createdAt: string; user: { name: string; email: string } | null }

const ACTIONS: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "auth.login_failed": "محاولة دخول فاشلة",
  "auth.logout": "تسجيل خروج",
  "auth.password_changed": "تغيير كلمة المرور",
  "user.create_owner": "إنشاء حساب المالك",
  "user.create": "إنشاء حساب",
  "user.update": "تعديل حساب",
  "settings.update": "تعديل الإعدادات",
  "amenity.create": "إضافة مرفق",
  "amenity.update": "تعديل مرفق",
  "amenity.delete": "حذف مرفق",
  "resource.create": "إضافة جزء",
  "resource.update": "تعديل جزء",
  "resource.delete": "حذف جزء",
  "conflict.create": "إضافة تعارض",
  "conflict.delete": "حذف تعارض",
  "pricing.create": "إضافة سعر",
  "pricing.update": "تعديل سعر",
  "pricing.delete": "حذف سعر",
  "booking.create": "إنشاء حجز",
  "booking.status": "تغيير حالة حجز",
  "booking.update": "تعديل حجز",
  "payment.verified": "التحقق من دفعة",
  "payment.rejected": "رفض دفعة",
  "guest.update": "تعديل بيانات ضيف",
};

export default function AuditPage() {
  const { data, error, loading } = useApi<Log[]>("/api/admin/audit?limit=100");
  let body: ReactNode;
  if (loading && !data) body = <Loading />;
  else if (!data || data.length === 0) body = <Empty>لا توجد عمليات.</Empty>;
  else
    body = (
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="text-jood-ink/55"><th className="px-5 py-2 text-start font-normal">الوقت</th><th className="px-2 py-2 text-start font-normal">العملية</th><th className="px-2 py-2 text-start font-normal">المستخدم</th><th className="px-5 py-2 text-start font-normal">العنصر</th></tr></thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="border-t border-jood-green/10">
                <td className="px-5 py-2 whitespace-nowrap text-jood-ink/60">{dateTime(l.createdAt)}</td>
                <td className={`px-2 py-2 ${l.action === "auth.login_failed" ? "text-red-700" : ""}`}>{ACTIONS[l.action] ?? l.action}</td>
                <td className="px-2 py-2">{l.user?.name ?? "—"}</td>
                <td className="px-5 py-2 text-xs text-jood-ink/60" dir="ltr">{l.entityId ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <>
      <PageTitle title="سجل العمليات" />
      <p className="mb-4 text-sm text-jood-ink/60">آخر 100 عملية. لا يحفظ السجل كلمات المرور أو الآيبان أو رموز الدخول.</p>
      <ErrorNote>{error}</ErrorNote>
      <Card>{body}</Card>
    </>
  );
}

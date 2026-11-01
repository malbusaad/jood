import { useState } from "react";
import { Plus } from "lucide-react";
import { useUser } from "../auth";
import type { Role } from "../types";
import { Button, Card, ErrorNote, Field, Loading, PageTitle, dateTime, inputClass, useApi, useMutation } from "../ui";

interface Account { id: string; email: string; name: string; role: Role; active: boolean; lastLoginAt: string | null }

export default function UsersPage() {
  const me = useUser();
  const { data, error, loading, reload } = useApi<Account[]>("/api/admin/users");
  const m = useMutation();
  const [form, setForm] = useState<{ email: string; name: string; password: string; role: Role } | null>(null);
  return (
    <>
      <PageTitle title="الحسابات">
        <Button onClick={() => setForm({ email: "", name: "", password: "", role: "STAFF" })}><Plus className="size-4" /> حساب</Button>
      </PageTitle>
      <p className="mb-4 text-sm text-jood-ink/60">«موظف» يدير الحجوزات والضيوف، ولا يرى الحساب البنكي ورموز الدخول، ولا يعدّل الأسعار والإعدادات.</p>
      <ErrorNote>{error || m.error}</ErrorNote>
      {form && (
        <Card title="حساب جديد" className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="الاسم"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
            <Field label="البريد"><input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} /></Field>
            <Field label="كلمة المرور المؤقتة" hint="10 أحرف على الأقل، ويغيّرها صاحب الحساب بعد الدخول"><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} /></Field>
            <Field label="الصلاحية">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className={inputClass}>
                <option value="STAFF">موظف</option>
                <option value="OWNER">مالك</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button busy={m.busy} onClick={async () => { if (await m.run("/api/admin/users", "POST", form)) { setForm(null); reload(); } }}>إنشاء</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>إلغاء</Button>
          </div>
        </Card>
      )}
      <Card>
        {loading && !data ? <Loading /> : (
          <ul className="-mx-5 divide-y divide-jood-green/10">
            {data?.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <span className="font-medium">{u.name}</span> <span dir="ltr" className="text-sm text-jood-ink/60">{u.email}</span>
                  <p className="text-xs text-jood-ink/55">{u.role === "OWNER" ? "مالك" : "موظف"} · {u.lastLoginAt ? `آخر دخول ${dateTime(u.lastLoginAt)}` : "لم يدخل بعد"}{!u.active && " · موقوف"}</p>
                </div>
                {u.id !== me.id && (
                  <Button variant={u.active ? "danger" : "secondary"} busy={m.busy} onClick={async () => { if (await m.run(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active })) reload(); }}>
                    {u.active ? "إيقاف" : "تفعيل"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { useAuth } from "../auth";
import { Button, ErrorNote, Field, inputClass } from "../ui";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? "/admin";

  if (!loading && user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-jood-green-950 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-jood-beige p-7 shadow-xl">
        <h1 className="font-display text-2xl font-semibold text-jood-green">لوحة إدارة استراحة الجود</h1>
        <p className="mt-1 text-sm text-jood-ink/60">سجّل الدخول للمتابعة</p>
        <div className="mt-6 space-y-4">
          <Field label="البريد الإلكتروني">
            <input type="email" required autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} text-end`} />
          </Field>
          <Field label="كلمة المرور">
            <input type="password" required autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" busy={busy} className="w-full py-3">
            دخول
          </Button>
        </div>
      </form>
    </div>
  );
}

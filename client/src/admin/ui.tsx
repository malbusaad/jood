import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { STATUS } from "./labels";
import type { BookingStatus } from "./types";

/** Loads JSON from the admin API; `reload` refetches. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) window.location.assign("/admin/login");
        setError(e instanceof ApiError ? e.message : "تعذر الاتصال بالخادم");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Sends a mutation and reports its Arabic error message. */
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(path: string, method: string, body?: unknown): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await api<T>(path, { method, body: JSON.stringify(body ?? {}) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذر الاتصال بالخادم");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error, setError };
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} | إدارة استراحة الجود`;
  }, [title]);
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-semibold text-jood-green sm:text-3xl">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-jood-green/10 bg-white p-5 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-semibold text-jood-green">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-jood-green text-jood-beige hover:bg-jood-green-800",
  secondary: "border border-jood-green/25 text-jood-green hover:bg-jood-green/5",
  danger: "border border-red-300 text-red-800 hover:bg-red-50",
  ghost: "text-jood-green hover:bg-jood-green/5",
};

export function Button({ variant = "primary", busy, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
      {children}
    </p>
  );
}

export function Loading() {
  return (
    <div className="grid place-items-center py-16" aria-busy="true" aria-label="جارٍ التحميل">
      <Loader2 className="size-6 animate-spin text-jood-gold" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-jood-ink/60">{children}</p>;
}

export const inputClass =
  "w-full rounded-xl border border-jood-green/20 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-jood-gold disabled:bg-stone-50";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-jood-ink/80">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-jood-ink/55">{hint}</span>}
    </label>
  );
}

const sar = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function money(v: string | number) {
  return `${sar.format(Number(v))} ريال`;
}

const dt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });
export function dateTime(iso: string) {
  return dt.format(new Date(iso));
}

const shortDate = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export function dayLabel(iso: string) {
  return shortDate.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function nightsBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

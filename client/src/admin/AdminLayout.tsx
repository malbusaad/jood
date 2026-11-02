import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Bell,
  BedDouble,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Sofa,
  Tag,
  Users,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth, useUser } from "./auth";
import { Loading } from "./ui";

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  ownerOnly?: boolean;
}

const nav: NavItem[] = [
  { to: "/admin", label: "الرئيسية", Icon: LayoutDashboard },
  { to: "/admin/bookings", label: "الحجوزات", Icon: ClipboardList },
  { to: "/admin/calendar", label: "التقويم", Icon: CalendarDays },
  { to: "/admin/guests", label: "الضيوف", Icon: Users },
  { to: "/admin/amenities", label: "المرافق", Icon: Sofa },
  { to: "/admin/resources", label: "الأجزاء والتعارض", Icon: BedDouble, ownerOnly: true },
  { to: "/admin/pricing", label: "الأسعار", Icon: Tag, ownerOnly: true },
  { to: "/admin/settings", label: "الإعدادات", Icon: Settings },
  { to: "/admin/users", label: "الحسابات", Icon: UserCog, ownerOnly: true },
  { to: "/admin/audit", label: "سجل العمليات", Icon: ShieldCheck, ownerOnly: true },
];

/** Polls the unread notification count so new booking requests show up without refreshing. */
function useUnread() {
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ unread: number }>("/api/admin/notifications?limit=1")
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [location.pathname]);
  return unread;
}

export default function AdminLayout() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useUnread();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    document.documentElement.classList.add("admin");
    return () => document.documentElement.classList.remove("admin");
  }, []);

  const items = nav.filter((n) => !n.ownerOnly || user.role === "OWNER");

  const sidebar = (
    <nav aria-label="قائمة الإدارة" className="flex flex-col gap-1 p-3">
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/admin"}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? "bg-jood-gold/20 text-jood-gold" : "text-jood-beige/80 hover:bg-white/5"}`
          }
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-[#f7f5f0] text-jood-ink">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-jood-green-950 px-4 text-jood-beige print:hidden">
        <div className="flex items-center gap-3">
          <button type="button" className="rounded-md p-1.5 lg:hidden" aria-label={open ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/admin" className="font-display text-lg font-semibold">
            إدارة استراحة الجود
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/" target="_blank" className="hidden items-center gap-1 rounded-full px-3 py-1.5 text-xs text-jood-beige/70 hover:bg-white/5 sm:inline-flex">
            الموقع <ExternalLink aria-hidden className="size-3.5" />
          </Link>
          <Link to="/admin/notifications" className="relative rounded-full p-2 hover:bg-white/5" aria-label={unread ? `الإشعارات (${unread} غير مقروء)` : "الإشعارات"}>
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-jood-gold px-1 text-[11px] font-semibold text-jood-green-950">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <span className="hidden px-2 text-xs text-jood-beige/60 md:inline">{user.name}</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/admin/login", { replace: true });
            }}
            className="rounded-full p-2 hover:bg-white/5"
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto bg-jood-green print:hidden lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 top-14 z-20 lg:hidden">
            <button type="button" aria-label="إغلاق القائمة" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
            <aside className="relative h-full w-64 overflow-y-auto bg-jood-green">{sidebar}</aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

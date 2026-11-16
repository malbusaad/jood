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
  Plus,
  Settings,
  ShieldCheck,
  CalendarHeart,
  TicketPercent,
  MessageCircle,
  Wallet,
  BarChart3,
  FileUp,
  Images,
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

/** The menu in groups, so each task is easy to find. */
const groups: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: "/admin", label: "الرئيسية", Icon: LayoutDashboard }] },
  {
    title: "الحجوزات",
    items: [
      { to: "/admin/bookings", label: "الحجوزات", Icon: ClipboardList },
      { to: "/admin/calendar", label: "التقويم", Icon: CalendarDays },
      { to: "/admin/guests", label: "الضيوف", Icon: Users },
    ],
  },
  {
    title: "الأسعار والعروض",
    items: [
      { to: "/admin/pricing", label: "الأسعار الأساسية", Icon: Tag, ownerOnly: true },
      { to: "/admin/special-prices", label: "الأسعار الخاصة والمواسم", Icon: CalendarHeart, ownerOnly: true },
      { to: "/admin/discounts", label: "الخصومات وأكواد الخصم", Icon: TicketPercent, ownerOnly: true },
    ],
  },
  {
    title: "الاستراحة",
    items: [
      { to: "/admin/amenities", label: "المرافق والخدمات", Icon: Sofa },
      { to: "/admin/media", label: "الصور والفيديو", Icon: Images, ownerOnly: true },
      { to: "/admin/resources", label: "الأجزاء والتعارض", Icon: BedDouble, ownerOnly: true },
    ],
  },
  {
    title: "المالية",
    items: [
      { to: "/admin/expenses", label: "المصاريف", Icon: Wallet, ownerOnly: true },
      { to: "/admin/reports", label: "التقارير المالية", Icon: BarChart3, ownerOnly: true },
    ],
  },
  {
    title: "التواصل",
    items: [
      { to: "/admin/notifications", label: "الإشعارات", Icon: Bell },
      { to: "/admin/whatsapp", label: "أتمتة واتساب", Icon: MessageCircle, ownerOnly: true },
    ],
  },
  {
    title: "النظام",
    items: [
      { to: "/admin/settings", label: "الإعدادات", Icon: Settings },
      { to: "/admin/users", label: "الحسابات", Icon: UserCog, ownerOnly: true },
      { to: "/admin/audit", label: "سجل العمليات", Icon: ShieldCheck, ownerOnly: true },
      { to: "/admin/import", label: "استيراد السجل السابق", Icon: FileUp, ownerOnly: true },
    ],
  },
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

  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.ownerOnly || user.role === "OWNER") }))
    .filter((g) => g.items.length > 0);

  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-jood-gold to-jood-gold-light font-display text-lg font-bold text-jood-green-950 shadow-inner">ج</span>
        <div className="leading-tight">
          <p className="font-display text-base font-semibold text-jood-beige">استراحة الجود</p>
          <p className="text-[11px] text-jood-beige/50">لوحة الإدارة</p>
        </div>
      </div>
      <div className="px-3 pt-3">
        <Link to="/admin/bookings/new" className="flex items-center justify-center gap-2 rounded-xl bg-jood-gold px-3 py-2.5 text-sm font-semibold text-jood-green-950 shadow-sm transition hover:bg-jood-gold-light">
          <Plus aria-hidden className="size-4" /> حجز جديد
        </Link>
      </div>
      <nav aria-label="قائمة الإدارة" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {visible.map((g) => (
          <div key={g.title ?? "home"}>
            {g.title && <p className="mb-1.5 px-2 text-[10.5px] font-semibold tracking-wider text-jood-gold/60">{g.title}</p>}
            <div className="flex flex-col gap-0.5">
              {g.items.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/admin"}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm transition ${isActive ? "bg-white/10 font-medium text-white" : "text-jood-beige/75 hover:bg-white/5 hover:text-jood-beige"}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute inset-y-2 start-0 w-1 rounded-full bg-jood-gold" />}
                      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg transition ${isActive ? "bg-jood-gold text-jood-green-950" : "bg-white/5 text-jood-gold/80 group-hover:bg-white/10"}`}>
                        <Icon className="size-4" />
                      </span>
                      <span className="flex-1">{label}</span>
                      {to === "/admin/notifications" && unread > 0 && (
                        <span aria-hidden className="rounded-full bg-jood-gold px-1.5 text-[11px] font-semibold text-jood-green-950">{unread > 99 ? "99+" : unread}</span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-white/10 text-sm font-semibold text-jood-gold">{initials}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm text-jood-beige">{user.name}</p>
          <p className="text-[11px] text-jood-beige/50">{user.role === "OWNER" ? "المالك" : "موظف"}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#f7f5f0] text-jood-ink">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-jood-green-950 px-4 text-jood-beige print:hidden">
        <div className="flex items-center gap-3">
          <button type="button" className="rounded-md p-1.5 lg:hidden" aria-label={open ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/admin" className="font-display text-lg font-semibold lg:hidden">
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
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 bg-gradient-to-b from-jood-green to-jood-green-950 print:hidden lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 top-14 z-20 lg:hidden">
            <button type="button" aria-label="إغلاق القائمة" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
            <aside className="relative h-full w-72 max-w-[85vw] bg-gradient-to-b from-jood-green to-jood-green-950 shadow-2xl">{sidebar}</aside>
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

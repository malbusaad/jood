import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import LogoSlot from "./LogoSlot";
import { publicPages } from "../routes";

const headerLinks = publicPages.filter((p) =>
  ["/", "/amenities", "/gallery", "/pricing", "/faq", "/contact"].includes(p.path),
);

export default function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 bg-jood-green/95 text-jood-beige backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" onClick={() => setOpen(false)}>
            <LogoSlot />
          </Link>

          <nav className="hidden items-center gap-6 lg:flex" aria-label="التنقل الرئيسي">
            {headerLinks.map((p) => (
              <NavLink
                key={p.path}
                to={p.path}
                end
                className={({ isActive }) =>
                  `text-sm transition-colors hover:text-jood-gold ${isActive ? "text-jood-gold" : ""}`
                }
              >
                {p.label}
              </NavLink>
            ))}
            <Link
              to="/booking"
              className="rounded-full bg-jood-gold px-5 py-2 text-sm font-medium text-jood-green transition hover:bg-jood-gold-light"
            >
              احجز الآن
            </Link>
          </nav>

          <button
            type="button"
            className="rounded-md p-2 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {open && (
          <nav id="mobile-nav" className="border-t border-white/10 px-4 pb-4 lg:hidden" aria-label="التنقل">
            {publicPages.map((p) => (
              <NavLink
                key={p.path}
                to={p.path}
                end
                onClick={() => setOpen(false)}
                className="block py-2 text-sm hover:text-jood-gold"
              >
                {p.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-jood-green-950 text-jood-beige/80">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-2">
          <div>
            <LogoSlot className="text-jood-beige" />
            <p className="mt-3 text-sm">العزيزية، الخبر — المملكة العربية السعودية</p>
          </div>
          <nav className="grid grid-cols-2 gap-2 text-sm" aria-label="روابط التذييل">
            {publicPages.map((p) => (
              <Link key={p.path} to={p.path} className="hover:text-jood-gold">
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="border-t border-white/10 py-4 text-center text-xs">
          © {new Date().getFullYear()} استراحة الجود
        </p>
      </footer>
    </div>
  );
}

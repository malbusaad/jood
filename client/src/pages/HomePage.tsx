import { Link } from "react-router";

export default function HomePage() {
  return (
    <section className="relative isolate overflow-hidden bg-jood-green text-jood-beige">
      {/* مكان الصورة الرئيسية: تُرفع الصور الحقيقية للاستراحة من لوحة الإدارة */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-jood-green-800),var(--color-jood-green-950))]"
      />
      <div className="mx-auto flex min-h-[70dvh] max-w-6xl flex-col items-start justify-center gap-6 px-4 py-24">
        <p className="text-sm tracking-widest text-jood-gold">العزيزية · الخبر</p>
        <h1 className="text-4xl font-semibold leading-tight sm:text-6xl">أهلًا بكم في استراحة الجود</h1>
        <p className="max-w-xl text-lg text-jood-beige/80">
          مساحة هادئة تجمع العائلة والأصدقاء، بمرافق متكاملة وأجواء راقية.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/booking"
            className="rounded-full bg-jood-gold px-7 py-3 font-medium text-jood-green transition hover:bg-jood-gold-light"
          >
            احجز الآن
          </Link>
          <Link
            to="/amenities"
            className="rounded-full border border-jood-gold/60 px-7 py-3 transition hover:bg-white/5"
          >
            استكشف الاستراحة
          </Link>
        </div>
      </div>
    </section>
  );
}

import { Link } from "react-router";
import { ArrowLeft, Clock, MapPin, Moon } from "lucide-react";
import Pattern from "../components/Pattern";
import Reveal from "../components/Reveal";
import SectionHeading from "../components/SectionHeading";
import AmenityGrid from "../components/AmenityGrid";
import PricingCards from "../components/PricingCards";
import PriceCalendar from "../components/LazyPriceCalendar";
import GalleryGrid from "../components/GalleryGrid";
import VideoBlock from "../components/VideoBlock";
import ContactDetails from "../components/ContactDetails";
import { useSiteContent } from "../hooks/useSiteContent";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatTimeAr } from "../lib/format";

function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-2 text-jood-green underline decoration-jood-gold/60 underline-offset-8 transition hover:decoration-jood-gold"
    >
      {children}
      <ArrowLeft aria-hidden className="size-4 transition group-hover:-translate-x-1" />
    </Link>
  );
}

export default function HomePage() {
  usePageTitle();
  const site = useSiteContent();

  const facts = [
    { Icon: MapPin, label: "الموقع", value: `${site.general.location.district}، ${site.general.location.city}` },
    { Icon: Clock, label: "الدخول", value: formatTimeAr(site.stay.checkIn) },
    { Icon: Moon, label: "الخروج", value: formatTimeAr(site.stay.checkOut) },
  ];

  return (
    <>
      {/* الواجهة الرئيسية */}
      <section className="relative isolate overflow-hidden bg-jood-green-950 text-jood-beige">
        {site.media.heroImageUrl ? (
          <>
            <img
              src={site.media.heroImageUrl}
              alt=""
              fetchPriority="high"
              className="absolute inset-0 -z-20 size-full object-cover"
            />
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-l from-jood-green-950/90 via-jood-green-950/60 to-transparent" />
          </>
        ) : (
          <>
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_20%,var(--color-jood-green-800),var(--color-jood-green-950)_70%)]"
            />
            <Pattern className="-z-10 text-jood-gold" opacity={0.07} />
          </>
        )}
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-center px-4 py-20">
          <Reveal>
            <p className="text-sm tracking-[0.3em] text-jood-gold">{site.general.tagline}</p>
          </Reveal>
          <Reveal delay={100}>
            <h1 className="mt-5 max-w-3xl text-5xl leading-[1.15] font-semibold sm:text-7xl">{site.general.welcome}</h1>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-6 max-w-xl text-lg leading-9 text-jood-beige/80">{site.general.description}</p>
          </Reveal>
          <Reveal delay={300}>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/booking"
                className="rounded-full bg-jood-gold px-8 py-3.5 font-medium text-jood-green-950 transition hover:bg-jood-gold-light"
              >
                احجز الآن
              </Link>
              <Link
                to="/amenities"
                className="rounded-full border border-jood-gold/60 px-8 py-3.5 transition hover:bg-white/5"
              >
                استكشف الاستراحة
              </Link>
            </div>
          </Reveal>
          <Reveal delay={400}>
            <dl className="mt-16 grid max-w-2xl grid-cols-3 gap-4 border-t border-white/10 pt-8">
              {facts.map(({ Icon, label, value }) => (
                <div key={label}>
                  <dt className="flex items-center gap-2 text-xs text-jood-beige/60">
                    <Icon aria-hidden className="size-4 text-jood-gold" strokeWidth={1.5} />
                    {label}
                  </dt>
                  <dd className="mt-1 font-display text-base sm:text-lg">{value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* المرافق */}
      <section className="mx-auto max-w-6xl px-4 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow="المرافق" title="كل ما تحتاجه لجمعة مريحة">
            جلسات داخلية وخارجية تتسع لمختلف المناسبات، مع مطبخ متكامل ومساحات للعب.
          </SectionHeading>
          <MoreLink to="/amenities">جميع المرافق</MoreLink>
        </div>
        <div className="mt-12">
          <AmenityGrid amenities={site.amenities.slice(0, 6)} />
        </div>
      </section>

      {/* الأسعار والتقويم */}
      <section className="bg-white/50 py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="الأسعار" title="أسعار واضحة">
              أسعار حجز الاستراحة كاملة لليوم. يظهر لك السعر النهائي وتفاصيله قبل إرسال طلب الحجز.
            </SectionHeading>
            <div className="mt-10">
              <PricingCards weekdayPrices={site.weekdayPrices} />
            </div>
            <div className="mt-8">
              <MoreLink to="/pricing">تفاصيل الأسعار</MoreLink>
            </div>
          </div>
          <div>
            <SectionHeading eyebrow="التقويم" title="الأسعار والإتاحة">
              سعر كل يوم والأيام المحجوزة للاستراحة كاملة.
            </SectionHeading>
            <div className="mt-10">
              <PriceCalendar />
            </div>
          </div>
        </div>
      </section>

      {/* الصور */}
      <section className="mx-auto max-w-6xl px-4 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow="معرض الصور" title="لمحات من الاستراحة" />
          <MoreLink to="/gallery">المعرض كاملًا</MoreLink>
        </div>
        <div className="mt-12">
          <GalleryGrid images={site.media.gallery.slice(0, 6)} />
        </div>
      </section>

      {/* الفيديو */}
      <section className="relative isolate overflow-hidden bg-jood-green py-24 text-jood-beige">
        <Pattern className="-z-10 text-jood-gold" opacity={0.05} />
        <div className="mx-auto max-w-5xl px-4">
          <SectionHeading eyebrow="جولة مرئية" title="الفيديو التعريفي" tone="dark" center />
          <Reveal className="mt-12">
            <VideoBlock url={site.media.videoUrl} poster={site.media.heroImageUrl} />
          </Reveal>
        </div>
      </section>

      {/* التواصل */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="تواصل معنا" title="يسعدنا استقبالكم" />
          <div className="mt-8">
            <ContactDetails site={site} />
          </div>
        </div>
        <div className="rounded-3xl bg-jood-green p-10 text-jood-beige">
          <h3 className="font-display text-3xl font-semibold">جاهز لحجز يومك؟</h3>
          <p className="mt-3 leading-8 text-jood-beige/75">اختر التاريخ والمرافق التي تناسبك وأرسل طلب الحجز.</p>
          <Link
            to="/booking"
            className="mt-8 inline-block rounded-full bg-jood-gold px-8 py-3.5 font-medium text-jood-green-950 transition hover:bg-jood-gold-light"
          >
            احجز الآن
          </Link>
        </div>
      </section>
    </>
  );
}

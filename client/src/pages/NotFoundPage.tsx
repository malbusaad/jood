import { Link } from "react-router";
import { usePageTitle } from "../hooks/usePageTitle";

export default function NotFoundPage() {
  usePageTitle("الصفحة غير موجودة");
  return (
    <section className="mx-auto max-w-3xl px-4 py-32 text-center">
      <p className="font-display text-6xl text-jood-gold">404</p>
      <h1 className="mt-4 text-3xl font-semibold text-jood-green">الصفحة غير موجودة</h1>
      <Link to="/" className="mt-8 inline-block text-jood-green underline decoration-jood-gold underline-offset-8">
        العودة إلى الرئيسية
      </Link>
    </section>
  );
}

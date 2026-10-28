import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-jood-green">الصفحة غير موجودة</h1>
      <Link to="/" className="mt-6 inline-block text-jood-green underline decoration-jood-gold underline-offset-4">
        العودة إلى الرئيسية
      </Link>
    </section>
  );
}

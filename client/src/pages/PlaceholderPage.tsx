export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-jood-green sm:text-4xl">{title}</h1>
      <p className="mt-4 text-jood-ink/70">هذه الصفحة قيد الإنشاء وستكون متاحة قريبًا.</p>
    </section>
  );
}

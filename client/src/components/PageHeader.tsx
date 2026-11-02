import type { ReactNode } from "react";
import Pattern from "./Pattern";
import { usePageTitle } from "../hooks/usePageTitle";

export default function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  usePageTitle(title);
  return (
    <header className="relative isolate overflow-hidden bg-jood-green text-jood-beige">
      <Pattern className="text-jood-gold" />
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <h1 className="text-3xl font-semibold sm:text-5xl">{title}</h1>
        <span aria-hidden className="mt-5 block h-px w-16 bg-jood-gold" />
        {children && <div className="mt-5 max-w-2xl leading-8 text-jood-beige/75">{children}</div>}
      </div>
    </header>
  );
}

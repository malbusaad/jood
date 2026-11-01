import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ value, label = "نسخ" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable — the value stays visible to copy manually */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-jood-green/20 px-3 py-1 text-xs text-jood-green transition hover:bg-jood-green hover:text-jood-beige"
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copied ? "تم النسخ" : label}
    </button>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../api/client";
import { inputClass } from "../ui";

/** A customer as the existing guest records store them (the ID number is only shown masked). */
export interface SuggestedGuest {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  nationalIdMasked: string | null;
  bookingCount: number;
  lastStay: string | null;
}

/**
 * «اسم الضيف» with suggestions from previous customers while typing. Choosing one links the
 * booking to that customer's record; typing a new name simply continues as a new customer.
 */
export default function GuestAutocomplete({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (g: SuggestedGuest) => void }) {
  const [items, setItems] = useState<SuggestedGuest[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const listId = useId();
  const labelId = useId();

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      api<SuggestedGuest[]>(`/api/admin/guests/suggest?q=${encodeURIComponent(q)}`)
        .then((r) => {
          // Only the answer to the latest keystroke is shown.
          if (n !== seq.current) return;
          setItems(r);
          setActive(-1);
        })
        .catch(() => n === seq.current && setItems([]));
    }, 150);
    return () => clearTimeout(t);
  }, [value]);

  const show = open && items.length > 0;
  const pick = (g: SuggestedGuest) => {
    setOpen(false);
    onPick(g);
  };

  return (
    <div className="relative block">
      <span id={labelId} className="text-sm font-medium text-jood-ink/80">اسم الضيف</span>
      <div className="mt-1">
        <input
          role="combobox"
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-expanded={show}
          aria-controls={listId}
          aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              pick(items[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={inputClass}
        />
      </div>
      <span className="mt-1 block text-xs text-jood-ink/55">اكتب جزءًا من الاسم أو الجوال لاختيار عميل سابق، أو أكمل كتابة اسم عميل جديد.</span>
      {show && (
        <ul id={listId} role="listbox" aria-labelledby={labelId} className="absolute inset-x-0 top-[4.75rem] z-20 max-h-72 overflow-y-auto rounded-xl border border-jood-green/15 bg-white py-1 shadow-lg">
          {items.map((g, i) => (
            <li
              key={g.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(g)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-jood-gold/15" : "hover:bg-jood-gold/10"}`}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{g.name}</span>
                <span dir="ltr" className="text-xs text-jood-ink/60">{g.phone ? `+${g.phone}` : "بدون جوال"}</span>
              </span>
              <span className="block text-xs text-jood-ink/55">{g.bookingCount ? `حجوزات سابقة: ${g.bookingCount}` : "لا حجوزات سابقة"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

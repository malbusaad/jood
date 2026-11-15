import { useState } from "react";
import { Button, dayLabel, inputClass } from "../ui";

/** Picks separate days (e.g. Thursday and Saturday) for one booking: add a date, remove with ×. */
export default function DayChips({ days, onChange, label = "الأيام المحجوزة" }: { days: string[]; onChange: (days: string[]) => void; label?: string }) {
  const [pick, setPick] = useState("");
  const sorted = [...days].sort();
  function add() {
    if (!pick || days.includes(pick)) return setPick("");
    onChange([...days, pick].sort());
    setPick("");
  }
  return (
    <div role="group" aria-label={label}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-sm font-medium text-jood-ink/80">أضف يومًا</span>
          <input type="date" value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass} mt-1`} aria-label="يوم للإضافة" />
        </label>
        <Button variant="secondary" disabled={!pick} onClick={add}>إضافة اليوم</Button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={label}>
        {sorted.length === 0 && <li className="text-sm text-jood-ink/55">لم تُختر أيام بعد.</li>}
        {sorted.map((d) => (
          <li key={d} className="flex items-center gap-1 rounded-full bg-jood-green px-3 py-1 text-sm text-jood-beige">
            {dayLabel(d)}
            <button type="button" className="ms-1 rounded-full px-1 hover:bg-white/20" aria-label={`إزالة ${dayLabel(d)}`} onClick={() => onChange(days.filter((x) => x !== d))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** 1200 → «1,200 ريال» */
export function formatSAR(amount: number | string): string {
  return `${numberFmt.format(Number(amount))} ريال`;
}

/** "2026-11-12" → «الخميس، 12 نوفمبر 2026» */
export function formatDateAr(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

/** "14:00" → «2:00 ظهرًا»، "04:00" → «4:00 فجرًا» */
export function formatTimeAr(hhmm: string): string {
  const [hStr, mStr = "00"] = hhmm.split(":");
  const h = Number(hStr);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  let period: string;
  if (h < 5) period = "فجرًا";
  else if (h < 12) period = "صباحًا";
  else if (h < 15) period = "ظهرًا";
  else if (h < 18) period = "عصرًا";
  else period = "مساءً";
  return `${h12}:${mStr} ${period}`;
}

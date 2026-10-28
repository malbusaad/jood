const numberFmt = new Intl.NumberFormat("en-US");

/** 1200 → «1,200 ريال» */
export function formatSAR(amount: number): string {
  return `${numberFmt.format(amount)} ريال`;
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

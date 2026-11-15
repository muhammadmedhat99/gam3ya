/**
 * Calendar dates as ISO strings "YYYY-MM-DD" (association-local, no time zone).
 * All math is done on UTC dates so nothing shifts with the server's zone.
 */

export const GROUP_TIMEZONE = "Africa/Cairo";

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Adds months, clamping to the month's last day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUtc(target);
}

/** Today's date in Cairo as "YYYY-MM-DD". */
export function todayInCairo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GROUP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

const arabicFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: "UTC", ...options });

/** "2027-03-05" → "5 مارس 2027" */
export function formatDate(iso: string): string {
  return arabicFormat({ day: "numeric", month: "long", year: "numeric" }).format(toUtc(iso));
}

/** "2027-03-05" → "5 مارس" */
export function formatDayMonth(iso: string): string {
  return arabicFormat({ day: "numeric", month: "long" }).format(toUtc(iso));
}

/** "2027-03-07" → "الأحد، 7 مارس 2027" */
export function formatLongDate(iso: string): string {
  return arabicFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(toUtc(iso));
}

/** Egyptian relative time for recent events: "من 5 دقايق"، "من ساعتين"، "امبارح". */
export function timeAgo(isoTimestamp: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / 60000));
  if (minutes < 1) return "دلوقتي";
  if (minutes < 60) return minutes === 1 ? "من دقيقة" : minutes === 2 ? "من دقيقتين" : `من ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "من ساعة" : hours === 2 ? "من ساعتين" : `من ${hours} ساعات`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "امبارح";
  if (days < 7) return `من ${days} أيام`;
  return formatDate(new Date(isoTimestamp).toISOString().slice(0, 10));
}

/** "2026-10-05" → "أكتوبر 2026" */
export function formatMonthYear(iso: string): string {
  return arabicFormat({ month: "long", year: "numeric" }).format(toUtc(iso));
}

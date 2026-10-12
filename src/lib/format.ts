/** Formatting helpers. Dates: 12.10.2026, 24h time, money: 45 000 ₸ (SPEC §5.9, §8). */

export function formatMoney(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  const s = Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${s} ₸`;
}

export function formatDate(d: string | Date | null | undefined, timeZone = "Asia/Almaty"): string {
  if (!d) return "";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y}`;
  }
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return parts;
}

export function formatTime(d: string | Date | null | undefined, timeZone = "Asia/Almaty"): string {
  if (!d) return "";
  if (typeof d === "string" && /^\d{2}:\d{2}/.test(d)) return d.slice(0, 5);
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatDateTime(d: string | Date | null | undefined, timeZone = "Asia/Almaty"): string {
  if (!d) return "";
  return `${formatDate(d, timeZone)} ${formatTime(d, timeZone)}`;
}

/** YYYY-MM-DD of "now" in the given time zone. */
export function todayIn(timeZone = "Asia/Almaty", base: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
  return p; // en-CA gives YYYY-MM-DD
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Age in full years on a date. */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** Day-of-week 1..7 (Mon..Sun) for YYYY-MM-DD. */
export function isoWeekday(isoDate: string): number {
  const wd = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function monthRange(isoMonth: string): { from: string; to: string; days: string[] } {
  const [y, m] = isoMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${isoMonth}-${String(i + 1).padStart(2, "0")}`);
  return { from: days[0], to: days[days.length - 1], days };
}

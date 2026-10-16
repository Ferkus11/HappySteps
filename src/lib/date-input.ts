/**
 * Pure helpers for the localized date field (components/ui/date-field.tsx). The field shows `дд.мм.гггг` text and
 * submits ISO `yyyy-mm-dd`, so server actions and their validation stay unchanged.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in ISO form (no 2026-02-30). */
export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-10-12" → "12.10.2026"; anything else → "". */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/**
 * Formats what the person typed as `dd.mm.yyyy`, adding the dots by itself. An ISO date (paste, autofill, tests)
 * is converted as a whole.
 */
export function maskDate(raw: string): string {
  const trimmed = raw.trim();
  if (ISO.test(trimmed)) return isoToDisplay(trimmed) || trimmed;
  const digits = trimmed.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** "12.10.2026" → "2026-10-12"; incomplete or impossible dates → "". */
export function displayToIso(display: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(display);
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isIsoDate(iso) ? iso : "";
}

/** "2026-10" ± n months. */
export function shiftIsoMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Monday-first weeks of a month; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const lead = (first + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Shifts an ISO date by whole days (keyboard navigation in the calendar). */
export function shiftIsoDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

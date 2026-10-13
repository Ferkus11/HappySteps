/**
 * Garden quiet hours (kindergarten_settings.quiet_hours_start/end, default 21:00–08:00, garden time zone).
 * Pure helpers — notify() uses them to defer pushes (`notifications.deliver_after`); the bell row appears at once.
 */

const toSeconds = (hhmm: string): number => {
  const [h, m, s] = hhmm.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
};

/** Seconds since local midnight of `at` in `timeZone`. */
function localSeconds(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

/** Is `at` inside [start, end) local time? Handles the overnight window; start = end means "no quiet hours". */
export function inQuietHours(at: Date, timeZone: string, start: string, end: string): boolean {
  const s = toSeconds(start);
  const e = toSeconds(end);
  if (s === e) return false;
  const t = localSeconds(at, timeZone);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The moment the current quiet period ends, or null when `at` is outside quiet hours. */
export function quietHoursEnd(at: Date, timeZone: string, start: string, end: string): Date | null {
  if (!inQuietHours(at, timeZone, start, end)) return null;
  const t = localSeconds(at, timeZone);
  const delta = (toSeconds(end) - t + 86400) % 86400;
  const wholeSecond = at.getTime() - (at.getTime() % 1000);
  return new Date(wholeSecond + delta * 1000);
}

/** The later of two optional ISO instants (null when both are empty). */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

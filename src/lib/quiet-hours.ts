/**
 * Garden quiet hours (kindergarten_settings.quiet_hours_start/end, default 21:00–08:00, garden time zone).
 * Pure helpers — notify() uses them to defer pushes (`notifications.deliver_after`); the bell row appears at once.
 */

const toSeconds = (hhmm: string): number => {
  const [h, m, s] = hhmm.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
};

interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** Seconds since local midnight. */
  seconds: number;
}

/** Calendar date and time of day of `at` in `timeZone`. */
function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), seconds: get("hour") * 3600 + get("minute") * 60 + get("second") };
}

/** Offset of `timeZone` from UTC at the instant `ms` (local wall clock − UTC, in ms). */
function offsetAt(ms: number, timeZone: string): number {
  const p = localParts(new Date(ms), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day) + p.seconds * 1000 - (ms - (ms % 1000));
}

/**
 * The instant of a local wall-clock time in `timeZone`; `day` may overflow the month (Date.UTC normalises it).
 * DST-safe: the offset is re-read at the result; a wall time skipped by a DST jump resolves to after the jump.
 */
function zonedInstant(year: number, month: number, day: number, seconds: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day) + seconds * 1000;
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return new Date(Math.max(first, second));
}

/** Is `at` inside [start, end) local time? Handles the overnight window; start = end means "no quiet hours". */
export function inQuietHours(at: Date, timeZone: string, start: string, end: string): boolean {
  const s = toSeconds(start);
  const e = toSeconds(end);
  if (s === e) return false;
  const t = localParts(at, timeZone).seconds;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/**
 * The moment the current quiet period ends, or null when `at` is outside quiet hours. Computed from the local
 * calendar date (today's end when we are before it, otherwise tomorrow's), not by adding seconds, so a day that
 * is 23 or 25 hours long (DST change inside the window) still ends at the configured local time.
 */
export function quietHoursEnd(at: Date, timeZone: string, start: string, end: string): Date | null {
  if (!inQuietHours(at, timeZone, start, end)) return null;
  const p = localParts(at, timeZone);
  const e = toSeconds(end);
  return zonedInstant(p.year, p.month, p.seconds < e ? p.day : p.day + 1, e, timeZone);
}

/** The later of two optional ISO instants (null when both are empty). */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Quiet-hours policy for pushes (DECISIONS, stage 6 review). During the garden's quiet hours the bell row always
 * appears at once; only the push may wait for the end of them:
 * - never deferred: `absence.reported` (the morning report is time-critical), `attendance.not_marked`,
 *   and `announcement.new` of an announcement marked important;
 * - `message.new`: the chat module decides (only parent → staff messages wait, via the caller's `deliverAfter`);
 *   garden quiet hours are not added on top;
 * - every other (routine) type: deferred to the end of quiet hours.
 */
export function deferredByQuietHours(type: string, opts: { important?: boolean } = {}): boolean {
  if (type === "absence.reported" || type === "attendance.not_marked" || type === "message.new") return false;
  if (type === "announcement.new" && opts.important) return false;
  return true;
}

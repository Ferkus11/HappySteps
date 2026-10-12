/** Events calendar: shared constants and pure date logic (safe for client and server). */
import { addDays, isoWeekday, todayIn } from "@/lib/format";

export const EVENT_KINDS = ["matinee", "parent_meeting", "holiday", "day_off", "excursion", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const isMonth = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isDay = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Weeks (Mon..Sun) covering the month; days outside the month are included to fill the grid. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const start = addDays(first, 1 - isoWeekday(first));
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks: string[][] = [];
  let d = start;
  while (d < next || weeks.length === 0) {
    const w: string[] = [];
    for (let i = 0; i < 7; i++) {
      w.push(d);
      d = addDays(d, 1);
    }
    weeks.push(w);
  }
  return weeks;
}

/**
 * Event reminder (SPEC §5.6: push a day before). The cron runs hourly; for a kindergarten it
 * reminds about events of local "tomorrow" once the local time is past the end of quiet hours.
 * Returns the event date to remind about, or null when it is too early.
 */
export function reminderDate(now: Date, timeZone: string, quietHoursEnd = "08:00"): string | null {
  const today = todayIn(timeZone, now);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  if (hm < quietHoursEnd.slice(0, 5)) return null;
  return addDays(today, 1);
}

/** Pastel chip per kind (one calm tone each, no red). */
export const KIND_STYLE: Record<EventKind, string> = {
  matinee: "bg-tile-absent text-tile-absent-fg",
  parent_meeting: "bg-sky-soft text-sky-strong",
  holiday: "bg-tile-late text-tile-late-fg",
  day_off: "bg-tile-unmarked text-tile-unmarked-fg",
  excursion: "bg-tile-work text-tile-work-fg",
  other: "bg-surface-muted text-muted border border-border",
};
export const KIND_DOT: Record<EventKind, string> = {
  matinee: "bg-[#E07A5F]",
  parent_meeting: "bg-sky",
  holiday: "bg-[#E8A33D]",
  day_off: "bg-tile-unmarked-fg",
  excursion: "bg-tile-work-fg",
  other: "bg-faint",
};

export function timeRange(e: { start_time: string | null; end_time: string | null }) {
  if (!e.start_time) return null;
  return e.end_time ? `${e.start_time}–${e.end_time}` : e.start_time;
}


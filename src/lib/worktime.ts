/**
 * Work-time: types and pure helpers shared by the dashboard, /worktime, the timesheet and exports.
 * Day statuses themselves are computed in SQL (`worktime_range`) so every screen agrees.
 */
import { monthRange } from "@/lib/format";

export const DAY_STATUSES = ["work", "done", "late", "absent", "unmarked", "upcoming", "off"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const ABSENCE_KINDS = ["sick", "vacation", "day_off", "unexcused"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export interface WorkSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  auto_closed: boolean;
  edited: boolean;
  comment: string | null;
}

/** One row of `worktime_range(kg, from, to)`. */
export interface DayRow {
  user_id: string;
  full_name: string;
  archived: boolean;
  work_date: string;
  is_holiday: boolean;
  shift_start: string | null;
  shift_end: string | null;
  shift_source: "override" | "holiday" | "template" | "none";
  absence_kind: AbsenceKind | null;
  sessions: WorkSession[];
  first_start: string | null;
  worked_minutes: number;
  has_open: boolean;
  auto_closed: boolean;
  edited: boolean;
  late_minutes: number;
  outside_schedule: boolean;
  status: DayStatus;
}

export interface TileCounts {
  work: number;
  late: number;
  absent: number;
  unmarked: number;
}

/** The four dashboard tiles (SPEC §5.2) for the rows of one day. */
export function tileCounts(rows: Pick<DayRow, "status">[]): TileCounts {
  const c: TileCounts = { work: 0, late: 0, absent: 0, unmarked: 0 };
  for (const r of rows) {
    if (r.status === "work") c.work++;
    else if (r.status === "late") c.late++;
    else if (r.status === "absent") c.absent++;
    else if (r.status === "unmarked") c.unmarked++;
  }
  return c;
}

export interface TimesheetTotals {
  minutes: number;
  workedDays: number;
  lates: number;
  absences: number;
  missed: number;
  autoClosed: number;
  edited: number;
}

export interface TimesheetPerson {
  userId: string;
  fullName: string;
  archived: boolean;
  days: Record<string, DayRow>;
  totals: TimesheetTotals;
}

/** Groups day rows by person and sums the month. Absences count only on days with an expected shift. */
export function buildTimesheet(rows: DayRow[]): TimesheetPerson[] {
  const byUser = new Map<string, TimesheetPerson>();
  for (const r of rows) {
    let p = byUser.get(r.user_id);
    if (!p) {
      p = {
        userId: r.user_id,
        fullName: r.full_name,
        archived: r.archived,
        days: {},
        totals: { minutes: 0, workedDays: 0, lates: 0, absences: 0, missed: 0, autoClosed: 0, edited: 0 },
      };
      byUser.set(r.user_id, p);
    }
    p.days[r.work_date] = r;
    const t = p.totals;
    t.minutes += r.worked_minutes;
    if (r.sessions.length) t.workedDays++;
    if (r.status === "late") t.lates++;
    if (r.status === "absent" && r.shift_start) t.absences++;
    if (r.status === "unmarked") t.missed++;
    if (r.auto_closed) t.autoClosed++;
    if (r.edited) t.edited++;
  }
  return [...byUser.values()].sort((a, b) => Number(a.archived) - Number(b.archived) || a.fullName.localeCompare(b.fullName, "ru"));
}

/** Decimal hours with a comma, one digit: 510 → "8,5". Zero → "0". */
export function formatHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return String(h).replace(".", ",");
}

/** 125 → "2:05" (duration). */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export type CellKind = "hours" | "absence" | "unmarked" | "holiday" | "off" | "empty";

/** What a timesheet cell shows (shared by the page, .xlsx and .pdf). */
export function cellKind(r: DayRow | undefined): CellKind {
  if (!r) return "empty";
  if (r.sessions.length) return "hours";
  if (r.status === "absent") return "absence";
  if (r.status === "unmarked") return "unmarked";
  if (r.is_holiday && r.shift_source === "holiday") return "holiday";
  if (r.status === "off") return "off";
  return "empty";
}

export type CellCodes = Record<AbsenceKind | "unmarked" | "holiday", string>;

/** Text of one exported cell: hours (+ "*" edited, "°" auto-closed) or a letter code. */
export function cellText(r: DayRow | undefined, codes: CellCodes): string {
  const k = cellKind(r);
  if (!r) return "";
  if (k === "hours") return `${formatHours(r.worked_minutes)}${r.edited ? "*" : ""}${r.auto_closed ? "°" : ""}`;
  if (k === "absence") return codes[r.absence_kind ?? "unexcused"];
  if (k === "unmarked") return codes.unmarked;
  if (k === "holiday") return codes.holiday;
  return "";
}

/** Validates `YYYY-MM`; falls back to the month of `today`. */
export function parseMonth(value: string | undefined | null, today: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const y = Number(value.slice(0, 4));
    if (y >= 2020 && y <= 2100) return value;
  }
  return today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthDays(month: string): string[] {
  return monthRange(month).days;
}

/** Validates `YYYY-MM-DD`; falls back to `today`. */
export function parseDate(value: string | undefined | null, today: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return value;
  return today;
}

/** Local wall time (HH:MM) of an ISO timestamp in a time zone. */
export function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

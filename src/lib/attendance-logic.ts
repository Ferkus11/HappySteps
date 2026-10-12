/** Pure attendance logic (no I/O) — shared by pages, export and unit tests. */
import { isoWeekday } from "@/lib/format";

export const ABSENCE_REASONS = ["sick", "vacation", "family", "other"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];
export type MarkStatus = "present" | "absent";

export interface AttendanceRow {
  child_id: string;
  date: string;
  status: MarkStatus;
  reason: AbsenceReason | null;
}

export interface AbsenceReport {
  id: string;
  child_id: string;
  date_from: string;
  date_to: string;
  reason: AbsenceReason;
  comment: string | null;
}

export interface HolidayRow {
  date: string;
  kind: "holiday" | "day_off" | "working_day";
}

/** Same rule as SQL kg_is_working_day: weekends closed unless marked 'working_day'. */
export function isWorkingDay(date: string, holidays: HolidayRow[]): boolean {
  const h = holidays.find((x) => x.date === date);
  if (h) return h.kind === "working_day";
  return isoWeekday(date) < 6;
}

export function reportCovering(reports: AbsenceReport[], childId: string, date: string): AbsenceReport | null {
  return reports.find((r) => r.child_id === childId && r.date_from <= date && r.date_to >= date) ?? null;
}

export type Effective =
  | { status: "present" }
  | { status: "absent"; reason: AbsenceReason | null; fromReport: boolean }
  | { status: "none" };

/** The row wins; otherwise a parent's report means "absent"; otherwise not marked. */
export function effectiveStatus(row: Pick<AttendanceRow, "status" | "reason"> | null | undefined, report: Pick<AbsenceReport, "reason"> | null | undefined): Effective {
  if (row?.status === "present") return { status: "present" };
  if (row?.status === "absent") return { status: "absent", reason: row.reason ?? report?.reason ?? null, fromReport: false };
  if (report) return { status: "absent", reason: report.reason, fromReport: true };
  return { status: "none" };
}

export interface DayProgress {
  total: number;
  marked: number;
  present: number;
  absent: number;
}

export function dayProgress(list: Effective[]): DayProgress {
  return {
    total: list.length,
    marked: list.filter((e) => e.status !== "none").length,
    present: list.filter((e) => e.status === "present").length,
    absent: list.filter((e) => e.status === "absent").length,
  };
}

/** A parent may cancel a report until its first day starts; a started period can still be cut short. */
export function cancellable(report: Pick<AbsenceReport, "date_from" | "date_to">, today: string): "whole" | "rest" | false {
  if (report.date_from > today) return "whole";
  if (report.date_to > today) return "rest";
  return false;
}

// ─────────────── Monthly report grid ───────────────

export type Cell =
  | { kind: "out" } // child not in this group on that day
  | { kind: "off" } // kindergarten closed
  | { kind: "future" }
  | { kind: "present" }
  | { kind: "absent"; reason: AbsenceReason | null }
  | { kind: "none" };

export interface RosterEntry {
  child_id: string;
  full_name: string;
  in_from: string;
  in_to: string;
}

export interface GridRow {
  childId: string;
  name: string;
  cells: Cell[];
  present: number;
  absent: number;
}

export interface MonthGrid {
  days: { date: string; working: boolean; weekday: number }[];
  rows: GridRow[];
  presentPerDay: number[];
  absentPerDay: number[];
  totalPresent: number;
  totalAbsent: number;
}

export function buildMonthGrid(input: {
  days: string[];
  today: string;
  roster: RosterEntry[];
  rows: AttendanceRow[];
  reports: AbsenceReport[];
  holidays: HolidayRow[];
}): MonthGrid {
  const days = input.days.map((date) => ({ date, working: isWorkingDay(date, input.holidays), weekday: isoWeekday(date) }));
  const byKey = new Map(input.rows.map((r) => [`${r.child_id}|${r.date}`, r]));
  // A child can appear several times in the roster (left and came back): merge intervals per child.
  const children = new Map<string, { name: string; spans: [string, string][] }>();
  for (const r of input.roster) {
    const c = children.get(r.child_id) ?? { name: r.full_name, spans: [] };
    c.spans.push([r.in_from, r.in_to]);
    children.set(r.child_id, c);
  }
  const presentPerDay = days.map(() => 0);
  const absentPerDay = days.map(() => 0);
  const rows: GridRow[] = [...children.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "ru"))
    .map(([childId, c]) => {
      let present = 0;
      let absent = 0;
      const cells = days.map((d, i): Cell => {
        if (!c.spans.some(([f, t]) => f <= d.date && d.date <= t)) return { kind: "out" };
        const row = byKey.get(`${childId}|${d.date}`);
        if (!d.working && !row) return { kind: "off" };
        if (d.date > input.today) return { kind: "future" };
        const e = effectiveStatus(row, d.date <= input.today ? reportCovering(input.reports, childId, d.date) : null);
        if (e.status === "present") {
          present++;
          presentPerDay[i]++;
          return { kind: "present" };
        }
        if (e.status === "absent") {
          absent++;
          absentPerDay[i]++;
          return { kind: "absent", reason: e.reason };
        }
        return { kind: "none" };
      });
      return { childId, name: c.name, cells, present, absent };
    });
  return {
    days,
    rows,
    presentPerDay,
    absentPerDay,
    totalPresent: presentPerDay.reduce((s, x) => s + x, 0),
    totalAbsent: absentPerDay.reduce((s, x) => s + x, 0),
  };
}

/** YYYY-MM of a date, and month navigation. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

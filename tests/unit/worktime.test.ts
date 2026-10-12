import { describe, expect, it } from "vitest";
import { buildTimesheet, cellKind, cellText, formatDuration, formatHours, parseDate, parseMonth, shiftMonth, tileCounts, type DayRow } from "@/lib/worktime";

const row = (p: Partial<DayRow>): DayRow => ({
  user_id: "u1",
  full_name: "Бекова Айгуль",
  archived: false,
  work_date: "2026-10-12",
  is_holiday: false,
  shift_start: "08:00",
  shift_end: "17:00",
  shift_source: "template",
  absence_kind: null,
  sessions: [],
  first_start: null,
  worked_minutes: 0,
  has_open: false,
  auto_closed: false,
  edited: false,
  late_minutes: 0,
  outside_schedule: false,
  status: "unmarked",
  ...p,
});
const s = { id: "s", started_at: "2026-10-12T03:00:00Z", ended_at: "2026-10-12T12:00:00Z", auto_closed: false, edited: false, comment: null };
const codes = { sick: "Б", vacation: "О", day_off: "ОТ", unexcused: "НН", unmarked: "НО", holiday: "В" };

describe("worktime tiles", () => {
  it("counts the four statuses and ignores the rest", () => {
    const c = tileCounts([{ status: "work" }, { status: "late" }, { status: "late" }, { status: "absent" }, { status: "unmarked" }, { status: "done" }, { status: "off" }, { status: "upcoming" }]);
    expect(c).toEqual({ work: 1, late: 2, absent: 1, unmarked: 1 });
  });
});

describe("timesheet", () => {
  it("sums hours, lates, absences (only on shift days), missed days and markers per person", () => {
    const rows = [
      row({ work_date: "2026-10-01", sessions: [s], worked_minutes: 540, status: "done" }),
      row({ work_date: "2026-10-02", sessions: [s, s], worked_minutes: 500, status: "late", late_minutes: 25, edited: true }),
      row({ work_date: "2026-10-03", status: "absent", absence_kind: "sick", shift_start: null, shift_end: null, is_holiday: true, shift_source: "holiday" }),
      row({ work_date: "2026-10-05", status: "absent", absence_kind: "sick" }),
      row({ work_date: "2026-10-06", status: "unmarked" }),
      row({ work_date: "2026-10-07", sessions: [s], worked_minutes: 540, status: "done", auto_closed: true }),
      row({ user_id: "u0", full_name: "Архивная", archived: true, sessions: [s], worked_minutes: 60, status: "done" }),
      row({ user_id: "u2", full_name: "Абаева", status: "off", shift_start: null }),
    ];
    const ts = buildTimesheet(rows);
    expect(ts.map((p) => p.fullName)).toEqual(["Абаева", "Бекова Айгуль", "Архивная"]); // archived last
    const t = ts[1].totals;
    expect(t).toEqual({ minutes: 1580, workedDays: 3, lates: 1, absences: 1, missed: 1, autoClosed: 1, edited: 1 });
    expect(Object.keys(ts[1].days)).toHaveLength(6);
  });

  it("cell kinds and export text", () => {
    expect(cellKind(undefined)).toBe("empty");
    expect(cellKind(row({ sessions: [s], status: "done" }))).toBe("hours");
    expect(cellKind(row({ status: "absent", absence_kind: "vacation" }))).toBe("absence");
    expect(cellKind(row({ status: "unmarked" }))).toBe("unmarked");
    expect(cellKind(row({ status: "off", is_holiday: true, shift_source: "holiday", shift_start: null }))).toBe("holiday");
    expect(cellKind(row({ status: "off", shift_source: "none", shift_start: null }))).toBe("off");
    expect(cellKind(row({ status: "upcoming" }))).toBe("empty");
    expect(cellText(row({ sessions: [s], worked_minutes: 510, edited: true, auto_closed: true, status: "done" }), codes)).toBe("8,5*°");
    expect(cellText(row({ status: "absent", absence_kind: "day_off" }), codes)).toBe("ОТ");
    expect(cellText(row({ status: "absent", absence_kind: null }), codes)).toBe("НН");
    expect(cellText(row({ status: "unmarked" }), codes)).toBe("НО");
  });
});

describe("formatting and params", () => {
  it("formats hours and durations", () => {
    expect(formatHours(510)).toBe("8,5");
    expect(formatHours(480)).toBe("8");
    expect(formatHours(0)).toBe("0");
    expect(formatHours(545)).toBe("9,1");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(-3)).toBe("0:00");
  });
  it("parses month and date params safely", () => {
    expect(parseMonth("2026-09", "2026-10-12")).toBe("2026-09");
    expect(parseMonth("2026-13", "2026-10-12")).toBe("2026-10");
    expect(parseMonth("x'; drop", "2026-10-12")).toBe("2026-10");
    expect(parseMonth(undefined, "2026-10-12")).toBe("2026-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(parseDate("2026-10-01", "2026-10-12")).toBe("2026-10-01");
    expect(parseDate("2026-99-01", "2026-10-12")).toBe("2026-10-12");
    expect(parseDate(null, "2026-10-12")).toBe("2026-10-12");
  });
});

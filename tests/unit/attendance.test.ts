import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  cancellable,
  dayProgress,
  effectiveStatus,
  isMonth,
  isWorkingDay,
  reportCovering,
  shiftMonth,
  type AbsenceReport,
} from "@/lib/attendance-logic";

const rep = (child: string, from: string, to: string, reason: AbsenceReport["reason"] = "sick"): AbsenceReport => ({
  id: `${child}-${from}`,
  child_id: child,
  date_from: from,
  date_to: to,
  reason,
  comment: null,
});

describe("effective status", () => {
  it("row wins, report means absent, otherwise not marked", () => {
    expect(effectiveStatus(null, null)).toEqual({ status: "none" });
    expect(effectiveStatus(null, { reason: "sick" })).toEqual({ status: "absent", reason: "sick", fromReport: true });
    expect(effectiveStatus({ status: "present", reason: null }, { reason: "sick" })).toEqual({ status: "present" });
    expect(effectiveStatus({ status: "absent", reason: null }, { reason: "vacation" })).toEqual({ status: "absent", reason: "vacation", fromReport: false });
  });
  it("progress counts reported children as marked", () => {
    const p = dayProgress([effectiveStatus(null, null), effectiveStatus(null, { reason: "sick" }), effectiveStatus({ status: "present", reason: null }, null)]);
    expect(p).toEqual({ total: 3, marked: 2, present: 1, absent: 1 });
  });
  it("finds the report covering a date", () => {
    const r = [rep("a", "2026-10-12", "2026-10-14")];
    expect(reportCovering(r, "a", "2026-10-13")?.id).toBe("a-2026-10-12");
    expect(reportCovering(r, "a", "2026-10-15")).toBeNull();
    expect(reportCovering(r, "b", "2026-10-13")).toBeNull();
  });
});

describe("working days and cancel window", () => {
  it("mirrors kg_is_working_day", () => {
    expect(isWorkingDay("2026-10-12", [])).toBe(true); // Monday
    expect(isWorkingDay("2026-10-17", [])).toBe(false); // Saturday
    expect(isWorkingDay("2026-10-17", [{ date: "2026-10-17", kind: "working_day" }])).toBe(true);
    expect(isWorkingDay("2026-10-12", [{ date: "2026-10-12", kind: "holiday" }])).toBe(false);
  });
  it("parent cancels before the day starts; started period → only the rest", () => {
    expect(cancellable({ date_from: "2026-10-13", date_to: "2026-10-14" }, "2026-10-12")).toBe("whole");
    expect(cancellable({ date_from: "2026-10-12", date_to: "2026-10-14" }, "2026-10-12")).toBe("rest");
    expect(cancellable({ date_from: "2026-10-12", date_to: "2026-10-12" }, "2026-10-12")).toBe(false);
  });
});

describe("month grid", () => {
  it("respects group history, days off, reports and totals", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"]; // Thu Fri Sat Mon Tue
    const g = buildMonthGrid({
      days,
      today: "2026-10-05",
      roster: [
        { child_id: "a", full_name: "Бекова Аня", in_from: "2026-10-01", in_to: "2026-10-31" },
        { child_id: "b", full_name: "Алиев Борис", in_from: "2026-10-01", in_to: "2026-10-02" }, // transferred out
      ],
      rows: [
        { child_id: "a", date: "2026-10-01", status: "present", reason: null },
        { child_id: "a", date: "2026-10-02", status: "absent", reason: null },
        { child_id: "b", date: "2026-10-01", status: "present", reason: null },
      ],
      reports: [rep("a", "2026-10-05", "2026-10-09", "vacation")],
      holidays: [],
    });
    expect(g.rows.map((r) => r.name)).toEqual(["Алиев Борис", "Бекова Аня"]);
    const a = g.rows[1];
    expect(a.cells.map((c) => c.kind)).toEqual(["present", "absent", "off", "absent", "future"]);
    expect(a.cells[3]).toEqual({ kind: "absent", reason: "vacation" });
    expect([a.present, a.absent]).toEqual([1, 2]);
    const b = g.rows[0];
    expect(b.cells.map((c) => c.kind)).toEqual(["present", "none", "out", "out", "out"]);
    expect(g.presentPerDay).toEqual([2, 0, 0, 0, 0]);
    expect([g.totalPresent, g.totalAbsent]).toEqual([2, 2]);
  });
  it("month helpers", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
  });
});

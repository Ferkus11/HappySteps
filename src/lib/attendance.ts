import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { monthRange } from "@/lib/format";
import {
  buildMonthGrid,
  effectiveStatus,
  isWorkingDay,
  reportCovering,
  type AbsenceReport,
  type AttendanceRow,
  type Effective,
  type HolidayRow,
  type MonthGrid,
  type RosterEntry,
} from "@/lib/attendance-logic";

export interface AttGroup {
  id: string;
  name: string;
  color: string;
}

export const isAdminRole = (ctx: KgContext) => ctx.role === "owner" || ctx.role === "head";

/** Groups whose attendance the current role may open: owner/head/accountant — all, teacher — own. */
export async function attendanceGroups(supabase: SupabaseClient, ctx: KgContext): Promise<AttGroup[]> {
  const { data } = await supabase.from("groups").select("id, name, color").eq("kindergarten_id", ctx.kg.id).order("sort_order").order("name");
  const all = (data ?? []) as AttGroup[];
  if (["owner", "head", "accountant"].includes(ctx.role)) return all;
  if (ctx.role !== "teacher") return [];
  const { data: mine } = await supabase.from("group_teachers").select("group_id").eq("kindergarten_id", ctx.kg.id).eq("user_id", ctx.userId);
  const ids = new Set((mine ?? []).map((r) => r.group_id as string));
  return all.filter((g) => ids.has(g.id));
}

export async function isWorkingDayDb(supabase: SupabaseClient, kgId: string, date: string): Promise<boolean> {
  const { data } = await supabase.rpc("kg_is_working_day", { kg: kgId, d: date });
  return data !== false;
}

export interface DayChild {
  id: string;
  name: string;
  photoPath: string | null;
  allergies: string | null;
  effective: Effective;
  report: AbsenceReport | null;
}

/** One group's list for a day: roster by group history + rows + parents' reports. */
export async function loadGroupDay(supabase: SupabaseClient, groupId: string, date: string): Promise<DayChild[]> {
  const { data: roster } = await supabase.rpc("attendance_roster", { p_group: groupId, p_from: date, p_to: date });
  const list = (roster ?? []) as { child_id: string; full_name: string; photo_path: string | null; allergies: string | null }[];
  if (!list.length) return [];
  const ids = list.map((r) => r.child_id);
  const [{ data: rows }, { data: reports }] = await Promise.all([
    supabase.from("child_attendance").select("child_id, date, status, reason").in("child_id", ids).eq("date", date),
    supabase
      .from("absence_reports")
      .select("id, child_id, date_from, date_to, reason, comment")
      .in("child_id", ids)
      .is("cancelled_at", null)
      .lte("date_from", date)
      .gte("date_to", date),
  ]);
  const rowsBy = new Map(((rows ?? []) as AttendanceRow[]).map((r) => [r.child_id, r]));
  const reps = (reports ?? []) as AbsenceReport[];
  return list.map((c) => {
    const report = reportCovering(reps, c.child_id, date);
    return {
      id: c.child_id,
      name: c.full_name,
      photoPath: c.photo_path,
      allergies: c.allergies,
      effective: effectiveStatus(rowsBy.get(c.child_id), report),
      report,
    };
  });
}

export interface PortionRow {
  group_id: string;
  group_name: string;
  color: string;
  active: number;
  reported: number;
  marked: number;
  present: number | null;
  absent: number;
  expected: number;
  unmarked: number;
}

export async function loadPortions(supabase: SupabaseClient, kgId: string, date: string): Promise<PortionRow[]> {
  const { data, error } = await supabase.rpc("expected_portions", { kg: kgId, d: date });
  if (error) return [];
  return (data ?? []) as PortionRow[];
}

/** Monthly grid of a group (child × day), respecting the group history. */
export async function loadMonthGrid(supabase: SupabaseClient, kgId: string, groupId: string, month: string, today: string): Promise<MonthGrid> {
  const { from, to, days } = monthRange(month);
  const { data: roster } = await supabase.rpc("attendance_roster", { p_group: groupId, p_from: from, p_to: to });
  const entries = (roster ?? []) as RosterEntry[];
  const ids = [...new Set(entries.map((r) => r.child_id))];
  const [{ data: rows }, { data: reports }, { data: holidays }] = await Promise.all([
    ids.length
      ? supabase.from("child_attendance").select("child_id, date, status, reason").in("child_id", ids).eq("group_id", groupId).gte("date", from).lte("date", to)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("absence_reports")
          .select("id, child_id, date_from, date_to, reason, comment")
          .in("child_id", ids)
          .is("cancelled_at", null)
          .lte("date_from", to)
          .gte("date_to", from)
      : Promise.resolve({ data: [] }),
    supabase.from("holidays").select("date, kind").eq("kindergarten_id", kgId).gte("date", from).lte("date", to),
  ]);
  return buildMonthGrid({
    days,
    today,
    roster: entries,
    rows: (rows ?? []) as AttendanceRow[],
    reports: (reports ?? []) as AbsenceReport[],
    holidays: (holidays ?? []) as HolidayRow[],
  });
}

export { isWorkingDay };

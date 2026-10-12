import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DayRow } from "@/lib/worktime";

/**
 * Day rows from the SQL source of truth. The function itself limits rows to what the caller may
 * see (owner/head/accountant — everybody; other staff — only themselves; parents — nothing).
 */
export async function loadDays(supabase: SupabaseClient, kgId: string, from: string, to: string): Promise<DayRow[]> {
  const { data, error } = await supabase.rpc("worktime_range", { kg: kgId, p_from: from, p_to: to });
  if (error) {
    console.error("worktime_range", error.message);
    return [];
  }
  return ((data ?? []) as DayRow[]).map((r) => ({
    ...r,
    shift_start: r.shift_start ? r.shift_start.slice(0, 5) : null,
    shift_end: r.shift_end ? r.shift_end.slice(0, 5) : null,
  }));
}

/** The caller's open interval (may be from a previous day if they forgot to finish). */
export async function myOpenSession(supabase: SupabaseClient, kgId: string, userId: string) {
  const { data } = await supabase
    .from("work_sessions")
    .select("id, work_date, started_at")
    .eq("kindergarten_id", kgId)
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  return data as { id: string; work_date: string; started_at: string } | null;
}

export async function hasSchedule(supabase: SupabaseClient, kgId: string, userId: string) {
  const { count } = await supabase
    .from("staff_schedules")
    .select("id", { count: "exact", head: true })
    .eq("kindergarten_id", kgId)
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubStats, EnrollmentStatus, ScheduleItem } from "@/lib/clubs";

export interface Club {
  id: string;
  name: string;
  description: string | null;
  photo_path: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  age_from: number;
  age_to: number;
  schedule: ScheduleItem[];
  place: string | null;
  capacity: number;
}

export interface RosterParent {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
}

export interface RosterRow {
  enrollment_id: string;
  child_id: string;
  child_name: string;
  /** full years today (garden time zone); birth dates are not exposed by club_roster */
  age: number;
  group_name: string | null;
  allergies: string | null;
  status: EnrollmentStatus;
  queue_position: number | null;
  requested_at: string;
  started_on: string | null;
  parents: RosterParent[];
}

export interface ChildEnrollment {
  id: string;
  club_id: string;
  child_id: string;
  status: EnrollmentStatus;
  position: number | null;
  created_at: string;
}

const CLUB_COLUMNS = "id, name, description, photo_path, teacher_id, age_from, age_to, schedule, place, capacity, teacher:profiles!clubs_teacher_id_fkey(full_name)";

type ClubDb = Omit<Club, "teacher_name"> & { teacher: { full_name: string } | null };
const toClub = (r: ClubDb): Club => ({ ...r, teacher_name: r.teacher?.full_name ?? null, schedule: (r.schedule ?? []) as ScheduleItem[] });

/** Clubs the user may see (RLS: whole catalog, or own clubs for a club teacher). */
export async function loadClubs(supabase: SupabaseClient, kg: string, opts: { teacherId?: string } = {}): Promise<Club[]> {
  let q = supabase.from("clubs").select(CLUB_COLUMNS).eq("kindergarten_id", kg).order("name");
  if (opts.teacherId) q = q.eq("teacher_id", opts.teacherId);
  const { data } = await q;
  return ((data ?? []) as unknown as ClubDb[]).map(toClub);
}

export async function loadClub(supabase: SupabaseClient, kg: string, id: string): Promise<Club | null> {
  const { data } = await supabase.from("clubs").select(CLUB_COLUMNS).eq("kindergarten_id", kg).eq("id", id).maybeSingle();
  return data ? toClub(data as unknown as ClubDb) : null;
}

/** Place counters per club (visible to every role that sees the catalog). */
export async function loadStats(supabase: SupabaseClient, kg: string): Promise<Record<string, ClubStats>> {
  const { data } = await supabase.rpc("club_stats", { p_kg: kg });
  const out: Record<string, ClubStats> = {};
  for (const r of (data ?? []) as (ClubStats & { club_id: string })[]) out[r.club_id] = r;
  return out;
}

export const emptyStats = (capacity: number): ClubStats => ({ capacity, active: 0, requested: 0, queued: 0, free: capacity });

/** Open enrollments of the given children (parent view), with queue positions. */
export async function loadChildEnrollments(supabase: SupabaseClient, kg: string, childIds: string[]): Promise<ChildEnrollment[]> {
  if (!childIds.length) return [];
  const [{ data }, { data: pos }] = await Promise.all([
    supabase
      .from("club_enrollments")
      .select("id, club_id, child_id, status, created_at")
      .eq("kindergarten_id", kg)
      .in("child_id", childIds)
      .in("status", ["requested", "queued", "active"])
      .order("created_at"),
    supabase.rpc("club_queue_positions", { p_kg: kg }),
  ]);
  const positions = new Map(((pos ?? []) as { enrollment_id: string; queue_position: number }[]).map((p) => [p.enrollment_id, p.queue_position]));
  return ((data ?? []) as Omit<ChildEnrollment, "position">[]).map((e) => ({ ...e, position: positions.get(e.id) ?? null }));
}

/** Children of a club (requests, queue, attending) with parents' contacts; empty when the caller may not see it. */
export async function loadRoster(supabase: SupabaseClient, clubId: string): Promise<RosterRow[]> {
  const { data } = await supabase.rpc("club_roster", { p_club: clubId });
  return (data ?? []) as RosterRow[];
}

export interface PendingItem extends RosterRow {
  club: Club;
  stats: ClubStats;
}

/**
 * What waits for a decision in the given clubs: new requests and queued children whose turn has come
 * (a place is free for them). Oldest first.
 */
export async function loadPending(supabase: SupabaseClient, clubs: Club[], stats: Record<string, ClubStats>): Promise<PendingItem[]> {
  const rosters = await Promise.all(clubs.map((c) => loadRoster(supabase, c.id)));
  const out: PendingItem[] = [];
  clubs.forEach((club, i) => {
    const s = stats[club.id] ?? emptyStats(club.capacity);
    for (const r of rosters[i]) {
      if (r.status === "requested" || (r.status === "queued" && (r.queue_position ?? Infinity) <= s.free)) out.push({ ...r, club, stats: s });
    }
  });
  return out.sort((a, b) => a.requested_at.localeCompare(b.requested_at));
}

/**
 * For the owner/head «Требует внимания» card (stage 5): number of club requests waiting for a decision and
 * queued children whose place has freed up. RLS-checked: zero for roles that cannot see the clubs.
 */
export async function loadClubAttention(supabase: SupabaseClient, kg: string): Promise<{ requests: number; queueReady: number; total: number }> {
  const [{ count }, stats] = await Promise.all([
    supabase.from("club_enrollments").select("id", { count: "exact", head: true }).eq("kindergarten_id", kg).eq("status", "requested"),
    loadStats(supabase, kg),
  ]);
  const queueReady = Object.values(stats).reduce((s, x) => s + Math.min(x.queued, Math.max(0, x.free)), 0);
  const requests = count ?? 0;
  return { requests, queueReady, total: requests + queueReady };
}

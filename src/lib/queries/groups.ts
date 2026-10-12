import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GroupSummary {
  id: string;
  name: string;
  color: string;
  capacity: number;
  age_category: string | null;
  activeCount: number;
  teachers: { id: string; name: string }[];
}

export async function groupSummaries(supabase: SupabaseClient, kgId: string): Promise<GroupSummary[]> {
  const [{ data: groups }, { data: children }, { data: gt }] = await Promise.all([
    supabase.from("groups").select("id, name, color, capacity, age_category").eq("kindergarten_id", kgId).order("sort_order").order("name"),
    supabase.from("children").select("group_id").eq("kindergarten_id", kgId).eq("status", "active"),
    supabase.from("group_teachers").select("group_id, user_id, profiles(full_name)").eq("kindergarten_id", kgId),
  ]);
  const counts = new Map<string, number>();
  for (const c of children ?? []) if (c.group_id) counts.set(c.group_id, (counts.get(c.group_id) ?? 0) + 1);
  return (groups ?? []).map((g) => ({
    ...g,
    activeCount: counts.get(g.id) ?? 0,
    teachers: ((gt ?? []) as unknown as { group_id: string; user_id: string; profiles: { full_name: string } | null }[])
      .filter((x) => x.group_id === g.id)
      .map((x) => ({ id: x.user_id, name: x.profiles?.full_name ?? "" })),
  }));
}

/** Active teachers of the kindergarten (for pickers). */
export async function listTeachers(supabase: SupabaseClient, kgId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name)")
    .eq("kindergarten_id", kgId)
    .eq("role", "teacher")
    .eq("status", "active");
  return ((data ?? []) as unknown as { user_id: string; profiles: { full_name: string } | null }[])
    .map((r) => ({ id: r.user_id, name: r.profiles?.full_name ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

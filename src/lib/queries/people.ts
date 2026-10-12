import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth/roles";

export interface PersonRole {
  membershipId: string;
  role: Role;
  status: "active" | "archived";
  position: string | null;
}

export interface Person {
  userId: string;
  fullName: string;
  phone: string;
  birthDate: string | null;
  activated: boolean;
  roles: PersonRole[];
  groups: { id: string; name: string; color: string }[];
}

type Row = {
  id: string;
  role: Role;
  status: "active" | "archived";
  position: string | null;
  user_id: string;
  profiles: { full_name: string; phone: string; birth_date: string | null; activated_at: string | null } | null;
};

/** Staff (non-parent roles) of a kindergarten grouped by person. RLS limits visibility. */
export async function listStaff(supabase: SupabaseClient, kgId: string): Promise<Person[]> {
  const [{ data }, { data: gt }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, role, status, position, user_id, profiles(full_name, phone, birth_date, activated_at)")
      .eq("kindergarten_id", kgId)
      .neq("role", "parent")
      .order("created_at"),
    supabase.from("group_teachers").select("user_id, groups(id, name, color)").eq("kindergarten_id", kgId),
  ]);
  const byUser = new Map<string, Person>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.profiles) continue;
    const p =
      byUser.get(r.user_id) ??
      ({
        userId: r.user_id,
        fullName: r.profiles.full_name,
        phone: r.profiles.phone,
        birthDate: r.profiles.birth_date,
        activated: !!r.profiles.activated_at,
        roles: [],
        groups: [],
      } satisfies Person);
    p.roles.push({ membershipId: r.id, role: r.role, status: r.status, position: r.position });
    byUser.set(r.user_id, p);
  }
  for (const g of (gt ?? []) as unknown as { user_id: string; groups: { id: string; name: string; color: string } | null }[]) {
    const p = byUser.get(g.user_id);
    if (p && g.groups) p.groups.push(g.groups);
  }
  const order: Role[] = ["owner", "head", "accountant", "teacher", "club_teacher", "cook"];
  return [...byUser.values()].sort(
    (a, b) =>
      Math.min(...a.roles.map((r) => order.indexOf(r.role))) - Math.min(...b.roles.map((r) => order.indexOf(r.role))) ||
      a.fullName.localeCompare(b.fullName, "ru"),
  );
}

export function isActivePerson(p: Person) {
  return p.roles.some((r) => r.status === "active");
}

export async function listGroups(supabase: SupabaseClient, kgId: string) {
  const { data } = await supabase
    .from("groups")
    .select("id, name, color, capacity, age_category, sort_order")
    .eq("kindergarten_id", kgId)
    .order("sort_order")
    .order("name");
  return (data ?? []) as { id: string; name: string; color: string; capacity: number; age_category: string | null; sort_order: number }[];
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "@/lib/actions/safe";
import { audit } from "@/lib/audit";
import { addPersonToKindergarten, type InviteLink } from "@/lib/people";

/**
 * Child creation shared by «Добавить ребёнка» (children/actions.ts) and «Принять» in the waitlist.
 * Everything runs as the acting user — RLS decides (owner/head only).
 */
export interface NewChild {
  fullName: string;
  birthDate: string;
  groupId: string | null;
  enrolledOn: string;
  monthlyFee: number;
  allergies: string | null;
  medicalNotes: string | null;
}

export interface NewParent {
  fullName: string;
  phone: string;
  relation: string | null;
}

export interface ParentInviteResult {
  name: string;
  existed: boolean;
  invite: InviteLink | null;
}

export interface OverCapacity {
  group: string;
  count: number;
  capacity: number;
}

/** The group is already full (SPEC §5.1: a warning the head may confirm). */
export async function groupOverCapacity(supabase: SupabaseClient, groupId: string | null): Promise<OverCapacity | null> {
  if (!groupId) return null;
  const [{ data: g }, { count }] = await Promise.all([
    supabase.from("groups").select("name, capacity").eq("id", groupId).single(),
    supabase.from("children").select("id", { count: "exact", head: true }).eq("group_id", groupId).eq("status", "active"),
  ]);
  if (g && (count ?? 0) >= g.capacity) return { group: g.name as string, count: count ?? 0, capacity: g.capacity as number };
  return null;
}

/** Inserts the child card (+ audit «child.create»). */
export async function insertChild(supabase: SupabaseClient, kgId: string, v: NewChild): Promise<string> {
  const child = check(
    await supabase
      .from("children")
      .insert({
        kindergarten_id: kgId,
        full_name: v.fullName,
        birth_date: v.birthDate,
        group_id: v.groupId,
        enrolled_on: v.enrolledOn,
        monthly_fee: v.monthlyFee,
        allergies: v.allergies,
        medical_notes: v.medicalNotes,
      })
      .select("id")
      .single(),
  );
  await audit(supabase, kgId, "child.create", "child", child.id, { name: v.fullName });
  return child.id as string;
}

/** Finds or creates the parent's account, adds the membership, links the guardian and returns the invite. */
export async function linkParent(
  supabase: SupabaseClient,
  actorId: string,
  kgId: string,
  childId: string,
  p: NewParent,
): Promise<ParentInviteResult & { userId: string }> {
  const res = await addPersonToKindergarten({ supabase, actorId, kgId, fullName: p.fullName, phone: p.phone, role: "parent" });
  check(
    await supabase
      .from("child_guardians")
      .upsert({ child_id: childId, user_id: res.userId, kindergarten_id: kgId, relation: p.relation }, { onConflict: "child_id,user_id" }),
  );
  await audit(supabase, kgId, "guardian.link", "child", childId, { parent: res.userId });
  return { userId: res.userId, name: p.fullName, existed: res.existed, invite: res.invite };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memberIds, notify } from "@/lib/notify";

/** Heads of the garden get club notifications; when there is none — the owners. */
export async function adminRecipients(kg: string): Promise<string[]> {
  const heads = await memberIds(kg, ["head"]);
  return heads.length ? heads : memberIds(kg, ["owner"]);
}

/**
 * «Освободилось место» (SPEC §5.10): tells the head(s) — the owner(s) when there is no head — that a place of a club
 * became free while children are waiting. Call only after a permission-checked change that freed the place.
 */
export async function notifySpotFree(kg: string, clubId: string, clubName: string, queued: number): Promise<void> {
  if (queued <= 0) return;
  await notify({ kindergartenId: kg, userIds: await adminRecipients(kg), type: "club.spot_free", params: { club: clubName, count: queued }, url: `/clubs/${clubId}` });
}

/** Clubs where the child holds a place right now (read with the caller's RLS — before the place is released). */
export async function activeClubsOf(supabase: SupabaseClient, kg: string, childId: string): Promise<string[]> {
  const { data } = await supabase.from("club_enrollments").select("club_id").eq("kindergarten_id", kg).eq("child_id", childId).eq("status", "active");
  return [...new Set((data ?? []).map((r) => r.club_id as string))];
}

/** After places were released in these clubs (e.g. the child was archived): notify where a place is free and a queue waits. */
export async function notifyFreedClubs(supabase: SupabaseClient, kg: string, clubIds: string[]): Promise<void> {
  if (!clubIds.length) return;
  const [{ data: stats }, { data: clubs }] = await Promise.all([
    supabase.rpc("club_stats", { p_kg: kg }),
    supabase.from("clubs").select("id, name").eq("kindergarten_id", kg).in("id", clubIds),
  ]);
  const byId = new Map(((stats ?? []) as { club_id: string; free: number; queued: number }[]).map((s) => [s.club_id, s]));
  for (const c of clubs ?? []) {
    const s = byId.get(c.id as string);
    if (s && s.free > 0) await notifySpotFree(kg, c.id as string, c.name as string, s.queued);
  }
}

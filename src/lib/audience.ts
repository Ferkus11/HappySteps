import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { ActionError } from "@/lib/actions/result";

/** Audience of announcements and events (SPEC §5.5, §5.6). */
export const AUDIENCES = ["all", "groups", "staff"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface TargetGroup {
  id: string;
  name: string;
  color: string;
}

export interface PublishTargets {
  audiences: Audience[];
  groups: TargetGroup[];
}

const isAdminRole = (roles: readonly string[]) => roles.includes("owner") || roles.includes("head");

async function ownGroupIds(supabase: SupabaseClient, ctx: KgContext): Promise<string[]> {
  const { data } = await supabase.from("group_teachers").select("group_id").eq("user_id", ctx.userId).eq("kindergarten_id", ctx.kg.id);
  return (data ?? []).map((r) => r.group_id as string);
}

/**
 * What the current (selected) role may publish to — used by the UI. Owner/head: everything;
 * teacher: own groups only; other roles: nothing.
 */
export async function publishTargets(supabase: SupabaseClient, ctx: KgContext): Promise<PublishTargets | null> {
  const admin = ctx.role === "owner" || ctx.role === "head";
  if (!admin && ctx.role !== "teacher") return null;
  let q = supabase.from("groups").select("id, name, color").eq("kindergarten_id", ctx.kg.id).order("sort_order").order("name");
  if (!admin) q = q.in("id", await ownGroupIds(supabase, ctx));
  const { data } = await q;
  const groups = (data ?? []) as TargetGroup[];
  if (!admin && !groups.length) return null;
  return { audiences: admin ? [...AUDIENCES] : ["groups"], groups };
}

/**
 * Server-side check of a requested audience (RLS enforces the same rules again):
 * owner/head → any audience, groups of this kindergarten; teacher → only 'groups' and only own groups.
 */
export async function assertTargets(supabase: SupabaseClient, ctx: KgContext, audience: Audience, groupIds: string[]): Promise<string[]> {
  const ids = audience === "groups" ? [...new Set(groupIds)] : [];
  if (audience === "groups" && !ids.length) throw new ActionError("invalid");
  if (isAdminRole(ctx.roles)) {
    if (ids.length) {
      const { data } = await supabase.from("groups").select("id").eq("kindergarten_id", ctx.kg.id).in("id", ids);
      if ((data ?? []).length !== ids.length) throw new ActionError("forbidden");
    }
    return ids;
  }
  if (!ctx.roles.includes("teacher") || audience !== "groups") throw new ActionError("forbidden");
  const own = new Set(await ownGroupIds(supabase, ctx));
  if (!ids.every((id) => own.has(id))) throw new ActionError("forbidden");
  return ids;
}

/** Replaces the group links of an announcement/event with `ids` (RLS checks each new link). */
export async function syncGroups(
  supabase: SupabaseClient,
  table: "announcement_groups" | "event_groups",
  key: "announcement_id" | "event_id",
  id: string,
  kgId: string,
  ids: string[],
) {
  const { data: current } = await supabase.from(table).select("group_id").eq(key, id);
  const have = new Set((current ?? []).map((r) => r.group_id as string));
  const add = ids.filter((g) => !have.has(g));
  const remove = [...have].filter((g) => !ids.includes(g));
  if (add.length) {
    const { error } = await supabase.from(table).insert(add.map((g) => ({ [key]: id, group_id: g, kindergarten_id: kgId })));
    if (error) throw new ActionError("forbidden");
  }
  if (remove.length) {
    const { error } = await supabase.from(table).delete().eq(key, id).in("group_id", remove);
    if (error) throw new ActionError("forbidden");
  }
}

import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import type { Audience } from "@/lib/audience";
import type { EventKind } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  date: string;
  start_time: string | null;
  end_time: string | null;
  place: string | null;
  description: string | null;
  audience: Audience;
  groups: { id: string; name: string; color: string }[];
  manageable: boolean;
}

export interface Birthday {
  kind: "child" | "staff";
  person_id: string;
  full_name: string;
  day: string;
  age: number | null;
  group_name: string | null;
}

export interface DayOff {
  date: string;
  name: string;
}

type Row = Omit<CalendarEvent, "groups" | "manageable"> & {
  author_id: string | null;
  event_groups: { group_id: string; groups: { name: string; color: string } | null }[];
};

const SELECT = "id, title, kind, date, start_time, end_time, place, description, audience, author_id, event_groups(group_id, groups(name, color))";

function toEvent(ctx: KgContext, r: Row): CalendarEvent {
  const { author_id, event_groups, ...rest } = r;
  return {
    ...rest,
    start_time: rest.start_time?.slice(0, 5) ?? null,
    end_time: rest.end_time?.slice(0, 5) ?? null,
    groups: event_groups.filter((g) => g.groups).map((g) => ({ id: g.group_id, name: g.groups!.name, color: g.groups!.color })),
    manageable: ctx.role === "owner" || ctx.role === "head" || (ctx.role === "teacher" && author_id === ctx.userId),
  };
}

/**
 * RLS answers for the union of the user's roles in the garden. A teacher who is also a parent, viewing as
 * parent, must see only what a parent sees (SPEC §3: the screen follows the selected role). For such a user
 * this returns her children's ids and their groups; null when no narrowing is needed (role is not parent,
 * or parent is the only role — RLS already gives exactly the parent's view).
 */
async function parentScope(ctx: KgContext): Promise<{ children: Set<string>; groups: Set<string> } | null> {
  if (ctx.role !== "parent" || ctx.roles.every((r) => r === "parent")) return null;
  return parentChildren(ctx.kg.id, ctx.userId);
}

/** The user's active children in the garden and their groups (RLS: own children), once per request. */
const parentChildren = cache(async (kgId: string, userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("child_guardians")
    .select("child_id, children!inner(group_id, status)")
    .eq("user_id", userId)
    .eq("kindergarten_id", kgId)
    .eq("children.status", "active");
  const rows = (data ?? []) as unknown as { child_id: string; children: { group_id: string | null } }[];
  return {
    children: new Set(rows.map((r) => r.child_id)),
    groups: new Set(rows.map((r) => r.children.group_id).filter((g): g is string => !!g)),
  };
});

/** The parent audience rule (same as `audience_member` for a parent): everyone, or a group of her child. */
function parentSees(scope: { groups: Set<string> }, r: Row): boolean {
  if (r.audience === "all") return true;
  if (r.audience === "groups") return r.event_groups.some((g) => scope.groups.has(g.group_id));
  return false;
}

/** Events visible to the user (RLS) in [from, to]. */
export async function listEvents(supabase: SupabaseClient, ctx: KgContext, from: string, to: string, limit = 500): Promise<CalendarEvent[]> {
  const { data } = await supabase
    .from("events")
    .select(SELECT)
    .eq("kindergarten_id", ctx.kg.id)
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(limit);
  const scope = await parentScope(ctx);
  const rows = (data ?? []) as unknown as Row[];
  return (scope ? rows.filter((r) => parentSees(scope, r)) : rows).map((r) => toEvent(ctx, r));
}

/** Next events from `today` on. */
export async function upcomingEvents(supabase: SupabaseClient, ctx: KgContext, today: string, limit = 5): Promise<CalendarEvent[]> {
  const scope = await parentScope(ctx);
  let q = supabase.from("events").select(SELECT).eq("kindergarten_id", ctx.kg.id).gte("date", today);
  // Narrowed afterwards (groups of her own groups' events), so read a few more than needed.
  if (scope) q = q.neq("audience", "staff");
  const { data } = await q
    .order("date")
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(scope ? limit * 5 : limit);
  const rows = (data ?? []) as unknown as Row[];
  return (scope ? rows.filter((r) => parentSees(scope, r)).slice(0, limit) : rows).map((r) => toEvent(ctx, r));
}

/** Birthdays the user may see (role filtering inside the SQL function, narrowed to the parent view). */
export async function birthdays(supabase: SupabaseClient, ctx: KgContext, from: string, to: string): Promise<Birthday[]> {
  const { data, error } = await supabase.rpc("calendar_birthdays", { p_kg: ctx.kg.id, p_from: from, p_to: to });
  if (error) console.error("calendar_birthdays", error.message);
  const list = (data ?? []) as Birthday[];
  // Viewing as parent: only her own children (the SQL function answers for all her roles).
  const scope = await parentScope(ctx);
  return scope ? list.filter((b) => b.kind === "child" && scope.children.has(b.person_id)) : list;
}

/** Kindergarten days off (holidays table) in [from, to]. */
export async function daysOff(supabase: SupabaseClient, ctx: KgContext, from: string, to: string): Promise<DayOff[]> {
  const { data } = await supabase
    .from("holidays")
    .select("date, name, kind")
    .eq("kindergarten_id", ctx.kg.id)
    .gte("date", from)
    .lte("date", to)
    .in("kind", ["holiday", "day_off"])
    .order("date");
  return (data ?? []).map((h) => ({ date: h.date as string, name: h.name as string }));
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import type { Audience } from "@/lib/audience";
import type { EventKind } from "@/lib/events";

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
  return ((data ?? []) as unknown as Row[]).map((r) => toEvent(ctx, r));
}

/** Next events from `today` on. */
export async function upcomingEvents(supabase: SupabaseClient, ctx: KgContext, today: string, limit = 5): Promise<CalendarEvent[]> {
  const { data } = await supabase
    .from("events")
    .select(SELECT)
    .eq("kindergarten_id", ctx.kg.id)
    .gte("date", today)
    .order("date")
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(limit);
  return ((data ?? []) as unknown as Row[]).map((r) => toEvent(ctx, r));
}

/** Birthdays the user may see (role filtering inside the SQL function). */
export async function birthdays(supabase: SupabaseClient, ctx: KgContext, from: string, to: string): Promise<Birthday[]> {
  const { data, error } = await supabase.rpc("calendar_birthdays", { p_kg: ctx.kg.id, p_from: from, p_to: to });
  if (error) console.error("calendar_birthdays", error.message);
  return (data ?? []) as Birthday[];
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

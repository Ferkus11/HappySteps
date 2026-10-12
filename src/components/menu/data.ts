import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth/roles";
import { isMeal, type DayMenu, type MenuItem } from "./meals";

/** SPEC §3.4 «Меню»: full access. Everybody else in the kindergarten reads. */
export const MENU_EDITORS: Role[] = ["owner", "head", "cook"];

export function canEditMenu(role: Role): boolean {
  return MENU_EDITORS.includes(role);
}

/** Menus for the given dates (RLS applies). Missing days come back with no items. */
export async function loadMenus(supabase: SupabaseClient, kgId: string, dates: string[]): Promise<Record<string, DayMenu>> {
  const { data } = await supabase
    .from("menus")
    .select("date, updated_at, menu_items(meal, dish, composition, position)")
    .eq("kindergarten_id", kgId)
    .in("date", dates);
  const out: Record<string, DayMenu> = Object.fromEntries(dates.map((d) => [d, { date: d, updatedAt: null, items: [] }]));
  for (const row of (data ?? []) as { date: string; updated_at: string; menu_items: (Omit<MenuItem, "meal"> & { meal: string })[] }[]) {
    out[row.date] = {
      date: row.date,
      updatedAt: row.updated_at,
      items: row.menu_items.filter((i): i is MenuItem => isMeal(i.meal)),
    };
  }
  return out;
}

/** Recent days that have a menu (for "copy from another day"). */
export async function recentMenuDates(supabase: SupabaseClient, kgId: string, exclude: string, limit = 6): Promise<string[]> {
  const { data } = await supabase
    .from("menus")
    .select("date")
    .eq("kindergarten_id", kgId)
    .neq("date", exclude)
    .order("date", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: { date: string }) => r.date);
}

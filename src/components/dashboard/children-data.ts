import "server-only";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

/** The parent's active children in the current kindergarten (RLS: own children only). */
export async function myChildren(ctx: KgContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("child_guardians")
    .select("children!inner(id, full_name, birth_date, photo_path, status, group_id, groups(name, color))")
    .eq("user_id", ctx.userId)
    .eq("kindergarten_id", ctx.kg.id)
    .eq("children.status", "active");
  return ((data ?? []) as unknown as {
    children: { id: string; full_name: string; birth_date: string; photo_path: string | null; group_id: string | null; groups: { name: string; color: string } | null };
  }[]).map((r) => r.children);
}

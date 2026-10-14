import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppContext } from "@/lib/auth/context";

/**
 * Notification centre data. Reads go through the user's own client — RLS shows only own rows.
 *
 * Scope: the bell and the centre show the rows of the garden selected in the header plus garden-less
 * (platform) rows; the superadmin context shows garden-less rows only. Unread rows of the user's other
 * gardens are counted separately and mentioned on the page (their pushes switch the garden when opened).
 */

export const PAGE_SIZE = 30;

export interface NotificationItem {
  id: string;
  type: string;
  params: Record<string, string | number | null>;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

const COLUMNS = "id, type, params, url, read_at, created_at";

/**
 * Rows of deleted chat messages (`params.deleted = "yes"`, D-033) carry nothing but «Сообщение удалено»: the centre
 * and the badge leave them out (PostgREST `not.cs` on the jsonb params).
 */
const DELETED = ["params", "cs", JSON.stringify({ deleted: "yes" })] as const;

/** PostgREST filter for the context's scope. */
export function scopeOr(ctx: AppContext): string {
  return ctx.kind === "kindergarten" ? `kindergarten_id.eq.${ctx.kg.id},kindergarten_id.is.null` : "kindergarten_id.is.null";
}

/** Keyset cursor of the centre: the last loaded row's `created_at` and `id` (rows may share a timestamp). */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}

/** Newest first, ordered by (created_at, id); `before` = the last loaded row (keyset pagination). */
export async function loadNotifications(supabase: SupabaseClient, ctx: AppContext, before?: NotificationCursor | null): Promise<{ items: NotificationItem[]; more: boolean }> {
  let q = supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("user_id", ctx.userId)
    .not(...DELETED)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (before) {
    // One logic tree (scope AND older than the cursor): `created_at < c OR (created_at = c AND id < i)`.
    const c = `"${before.createdAt}"`;
    q = q.or(`and(or(${scopeOr(ctx)}),or(created_at.lt.${c},and(created_at.eq.${c},id.lt.${before.id})))`);
  } else {
    q = q.or(scopeOr(ctx));
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as NotificationItem[];
  return { items: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE };
}

export async function unreadCount(supabase: SupabaseClient, ctx: AppContext): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .not(...DELETED)
    .is("read_at", null)
    .or(scopeOr(ctx));
  return count ?? 0;
}

/** Unread rows of the user's other active gardens (shown as a hint in the centre). */
export async function unreadElsewhere(supabase: SupabaseClient, ctx: AppContext): Promise<number> {
  const current = ctx.kind === "kindergarten" ? ctx.kg.id : null;
  const others = [...new Set(ctx.memberships.map((m) => m.kindergarten_id))].filter((id) => id !== current);
  if (!others.length) return 0;
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .not(...DELETED)
    .is("read_at", null)
    .in("kindergarten_id", others);
  return count ?? 0;
}

/** Disabled types of the user (no row = enabled). */
export async function disabledTypes(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase.from("notification_preferences").select("type").eq("user_id", userId).eq("enabled", false);
  return (data ?? []).map((r) => r.type as string);
}

export { safeAppPath } from "@/lib/safe-path";

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import type { Audience } from "@/lib/audience";

export interface AnnouncementListItem {
  id: string;
  title: string;
  body: string;
  important: boolean;
  audience: Audience;
  created_at: string;
  author_id: string | null;
  author: string | null;
  groups: { name: string; color: string }[];
  photos: number;
  pdfs: number;
  read: boolean;
  stats: { total: number; read: number } | null;
}

type Row = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  audience: Audience;
  created_at: string;
  author_id: string | null;
  author: { full_name: string } | null;
  announcement_groups: { groups: { name: string; color: string } | null }[];
  announcement_files: { kind: "photo" | "pdf" }[];
};

/** Announcements visible to the user (RLS), important first, then newest. */
export async function listAnnouncements(
  supabase: SupabaseClient,
  ctx: KgContext,
  opts: { importantOnly?: boolean; limit?: number; withStats?: boolean } = {},
): Promise<AnnouncementListItem[]> {
  let q = supabase
    .from("announcements")
    .select(
      "id, title, body, important, audience, created_at, author_id, author:profiles!announcements_author_id_fkey(full_name), announcement_groups(groups(name, color)), announcement_files(kind)",
    )
    .eq("kindergarten_id", ctx.kg.id)
    .order("important", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.importantOnly) q = q.eq("important", true);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: reads }, statsRes] = await Promise.all([
    supabase.from("announcement_reads").select("announcement_id").eq("user_id", ctx.userId).in("announcement_id", ids),
    opts.withStats ? supabase.rpc("announcement_stats", { p_ids: ids }) : Promise.resolve({ data: [] }),
  ]);
  const readSet = new Set((reads ?? []).map((r) => r.announcement_id as string));
  const stats = new Map(((statsRes.data ?? []) as { announcement_id: string; total: number; read: number }[]).map((s) => [s.announcement_id, s]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    important: r.important,
    audience: r.audience,
    created_at: r.created_at,
    author_id: r.author_id,
    author: r.author?.full_name ?? null,
    groups: r.announcement_groups.map((g) => g.groups).filter((g): g is { name: string; color: string } => !!g),
    photos: r.announcement_files.filter((f) => f.kind === "photo").length,
    pdfs: r.announcement_files.filter((f) => f.kind === "pdf").length,
    read: readSet.has(r.id) || r.author_id === ctx.userId,
    stats: stats.has(r.id) ? { total: stats.get(r.id)!.total, read: stats.get(r.id)!.read } : null,
  }));
}

/** UI hint only (RLS decides): can the current role edit/delete/see stats of this announcement? */
export function canManage(ctx: KgContext, authorId: string | null) {
  return ctx.role === "owner" || ctx.role === "head" || (authorId === ctx.userId && ctx.role === "teacher");
}

/** "Напомнить" is rate-limited to once per hour (enforced in claim_announcement_reminder()). */
export function reminderLocked(remindedAt: string | null, now: Date = new Date()) {
  return !!remindedAt && now.getTime() - new Date(remindedAt).getTime() < 3600_000;
}

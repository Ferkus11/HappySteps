import { cookies } from "next/headers";
import { loadContext } from "@/lib/auth/context";
import { CONTEXT_COOKIE } from "@/lib/auth/constants";
import { createClient } from "@/lib/supabase/server";
import { NOTIFICATION_AUDIENCE, isNotificationType } from "@/lib/notification-types";
import { safeAppPath } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Target of a push click: marks the notification read and goes to its link. When the notification belongs to
 * another garden of the user, switches the header context to that garden first (a role that receives this
 * type, the current role when it fits) — the link would not open in the wrong garden. Own rows only (RLS).
 */
/** Relative redirect: the app may run behind a proxy, so the request host is not trusted for an absolute URL. */
const go = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = go("/notifications");
  const r = await loadContext();
  // Signed out (session expired): back here after the login.
  if (r.state === "anonymous") return go(UUID.test(id) ? `/login?next=${encodeURIComponent(`/notifications/${id}/open`)}` : "/login");
  if (r.state !== "ok" || !UUID.test(id)) return home;
  const ctx = r.ctx;
  const supabase = await createClient();
  const { data: n } = await supabase.from("notifications").select("id, kindergarten_id, type, url, read_at").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!n) return home;
  if (!n.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id).eq("user_id", ctx.userId);

  const kg = n.kindergarten_id as string | null;
  const currentKg = ctx.kind === "kindergarten" ? ctx.kg.id : null;
  if (kg && kg !== currentKg) {
    const wanted = isNotificationType(n.type) ? NOTIFICATION_AUDIENCE[n.type] : [];
    const options = ctx.memberships.filter((m) => m.kindergarten_id === kg);
    const pick =
      options.find((m) => ctx.kind === "kindergarten" && m.role === ctx.role && wanted.includes(m.role)) ??
      options.find((m) => wanted.includes(m.role)) ??
      options[0];
    if (!pick) return home; // no longer a member there
    (await cookies()).set(CONTEXT_COOKIE, `${kg}:${pick.role}`, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
    await supabase.from("profiles").update({ last_context: `${kg}:${pick.role}` }).eq("id", ctx.userId);
  }
  return go(safeAppPath(n.url as string | null) ?? "/notifications");
}

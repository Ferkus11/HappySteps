import "server-only";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { unreadTotal } from "@/lib/chats";
import { unreadCount } from "@/lib/notifications-data";

/**
 * Header badges (unread chats, notifications). Modules register their counters here.
 * Notifications: unread rows of the selected garden (+ garden-less ones), see lib/notifications-data.ts.
 */
export async function getShellCounters(ctx: KgContext): Promise<{ chats: number; notifications: number }> {
  const supabase = await createClient();
  const [chats, notifications] = await Promise.all([unreadTotal(supabase, ctx), unreadCount(supabase, ctx)]);
  return { chats, notifications };
}

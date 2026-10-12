import "server-only";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { unreadTotal } from "@/lib/chats";

/**
 * Header badges (unread chats, notifications). Modules register their counters here.
 */
export async function getShellCounters(ctx: KgContext): Promise<{ chats: number; notifications: number }> {
  const supabase = await createClient();
  return { chats: await unreadTotal(supabase, ctx), notifications: 0 };
}

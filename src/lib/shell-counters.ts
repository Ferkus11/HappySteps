import "server-only";
import type { KgContext } from "@/lib/auth/context";

/**
 * Header badges (unread chats, notifications). Modules register their counters here.
 * Stage 1: no chat/notification tables yet.
 */
export async function getShellCounters(_ctx: KgContext): Promise<{ chats: number; notifications: number }> {
  return { chats: 0, notifications: 0 };
}

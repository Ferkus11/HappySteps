import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadChatList } from "@/lib/chats";
import { ChatsFrame } from "@/components/chats/chats-frame";

/** List of chats stays mounted (and live) while conversations switch on the right. */
export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireKg();
  const supabase = await createClient();
  const chats = await loadChatList(supabase, ctx);
  return (
    <ChatsFrame initial={chats} userId={ctx.userId} timezone={ctx.settings.timezone}>
      {children}
    </ChatsFrame>
  );
}

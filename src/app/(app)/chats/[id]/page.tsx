import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadChat, loadMessages, loadParticipants, loadQuotes, quietNow, staffSide } from "@/lib/chats";
import { zUuid } from "@/lib/validation";
import { Conversation } from "@/components/chats/conversation";

export async function generateMetadata() {
  return { title: (await getTranslations("chats"))("title") };
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!zUuid.safeParse(id).success) notFound();
  const ctx = await requireKg();
  const supabase = await createClient();
  const chat = await loadChat(supabase, ctx, id);
  if (!chat) notFound();
  const t = await getTranslations("chats");
  const tr = await getTranslations("roles");

  const [page, participants, canWrite, mineStaff] = await Promise.all([
    loadMessages(supabase, id),
    loadParticipants(supabase, id),
    supabase.rpc("can_write_chat", { p_chat: id }),
    staffSide(supabase, ctx, chat),
  ]);
  const quotes = await loadQuotes(supabase, page.messages);

  const otherId = chat.kind === "direct" ? (chat.user_a === ctx.userId ? chat.user_b : chat.user_a) : null;
  const other = otherId ? participants.find((x) => x.user_id === otherId) : null;
  let otherReadAt: string | null = null;
  if (otherId) {
    const { data } = await supabase.from("chat_reads").select("last_read_at").eq("chat_id", id).eq("user_id", otherId).maybeSingle();
    otherReadAt = data?.last_read_at ?? null;
  }
  const title = chat.kind === "group" ? (chat.groups?.name ?? t("groupChat")) : chat.kind === "staff" ? t("staffChat") : (other?.full_name ?? t("unknownPerson"));
  const subtitle = chat.kind === "direct" && other?.chat_role ? tr(other.chat_role) : null;

  return (
    <Conversation
      key={id}
      chat={{ id, kind: chat.kind, title, subtitle, color: chat.groups?.color ?? null }}
      me={ctx.userId}
      timezone={ctx.settings.timezone}
      initialMessages={page.messages}
      quotes={quotes}
      hasMore={page.hasMore}
      participants={participants}
      otherReadAt={otherReadAt}
      staffSide={mineStaff}
      parentsCanWrite={chat.parents_can_write}
      canWrite={canWrite.data === true}
      moderator={chat.kind === "group" && (ctx.roles.includes("owner") || ctx.roles.includes("head"))}
      quiet={quietNow(ctx)}
    />
  );
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { CHAT_PAGE, inQuietHours, localTime, sortChats, type ChatFile, type ChatKind, type ChatMessage, type ChatPerson, type ChatSummary } from "@/lib/chats-logic";

export const MESSAGE_COLUMNS = "id, chat_id, author_id, body, reply_to, created_at, edited_at, deleted_at, deleted_by, message_files(id, message_id, kind, name, size, mime)";

type MessageRow = Omit<ChatMessage, "files"> & { message_files: ChatFile[] | null };

export function toMessage(r: MessageRow): ChatMessage {
  const { message_files, ...rest } = r;
  return { ...rest, files: [...(message_files ?? [])].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Chats of the current user in the selected garden (RLS + membership rules in SQL). */
export async function loadChatList(supabase: SupabaseClient, ctx: KgContext): Promise<ChatSummary[]> {
  const { data, error } = await supabase.rpc("chat_list", { p_kg: ctx.kg.id });
  if (error) console.error("chat_list", error.message);
  return sortChats((data ?? []) as ChatSummary[]);
}

export async function unreadTotal(supabase: SupabaseClient, ctx: KgContext): Promise<number> {
  const { data } = await supabase.rpc("chat_unread_total", { p_kg: ctx.kg.id });
  return typeof data === "number" ? data : 0;
}

/** A page of messages, oldest first. `before` = created_at of the oldest loaded message. */
export async function loadMessages(supabase: SupabaseClient, chatId: string, before?: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  let q = supabase.from("messages").select(MESSAGE_COLUMNS).eq("chat_id", chatId).order("created_at", { ascending: false }).limit(CHAT_PAGE + 1);
  if (before) q = q.lt("created_at", before);
  const { data } = await q;
  const rows = (data ?? []) as unknown as MessageRow[];
  return { messages: rows.slice(0, CHAT_PAGE).reverse().map(toMessage), hasMore: rows.length > CHAT_PAGE };
}

/** Quoted messages that are not in the loaded page. */
export async function loadQuotes(supabase: SupabaseClient, messages: ChatMessage[]): Promise<ChatMessage[]> {
  const have = new Set(messages.map((m) => m.id));
  const missing = [...new Set(messages.map((m) => m.reply_to).filter((id): id is string => !!id && !have.has(id)))];
  if (!missing.length) return [];
  const { data } = await supabase.from("messages").select(MESSAGE_COLUMNS).in("id", missing);
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage);
}

export async function loadParticipants(supabase: SupabaseClient, chatId: string): Promise<ChatPerson[]> {
  const { data } = await supabase.rpc("chat_participants", { p_chat: chatId });
  return (data ?? []) as ChatPerson[];
}

export interface ChatMeta {
  id: string;
  kind: ChatKind;
  group_id: string | null;
  parents_can_write: boolean;
  user_a: string | null;
  user_b: string | null;
  groups: { name: string; color: string } | null;
}

export async function loadChat(supabase: SupabaseClient, ctx: KgContext, id: string): Promise<ChatMeta | null> {
  const { data } = await supabase
    .from("chats")
    .select("id, kind, group_id, parents_can_write, user_a, user_b, groups(name, color)")
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  return (data as unknown as ChatMeta) ?? null;
}

/** Does the current user take part on the staff side of the chat? (mirrors SQL chat_staff_side) */
export async function staffSide(supabase: SupabaseClient, ctx: KgContext, chat: Pick<ChatMeta, "kind" | "group_id">): Promise<boolean> {
  if (chat.kind !== "group") return ctx.roles.some((r) => r !== "parent");
  if (ctx.roles.includes("owner") || ctx.roles.includes("head")) return true;
  if (!ctx.roles.includes("teacher") || !chat.group_id) return false;
  const { data } = await supabase.from("group_teachers").select("group_id").eq("group_id", chat.group_id).eq("user_id", ctx.userId).maybeSingle();
  return !!data;
}

/** Quiet hours right now in the garden's time zone (composer hint for parents). */
export function quietNow(ctx: KgContext, at: Date = new Date()): boolean {
  const s = ctx.settings;
  return inQuietHours(localTime(s.timezone, at), s.quiet_hours_start.slice(0, 5), s.quiet_hours_end.slice(0, 5));
}

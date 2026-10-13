"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/service";
import { zUuid } from "@/lib/validation";
import type { KgContext } from "@/lib/auth/context";
import { commitUpload, prepareUpload, type PreparedUpload } from "@/lib/uploads";
import type { DeclaredFile } from "@/lib/uploads-core";
import { CHAT_TEXT_MAX, type ChatMessage, type ChatPerson, type ChatSummary } from "@/lib/chats-logic";
import { MESSAGE_COLUMNS, loadChatList, loadMessages, loadParticipants, loadQuotes, toMessage, unreadTotal } from "@/lib/chats";

const BUCKET = "chat-files";

const sendSchema = z.object({
  chatId: zUuid,
  id: zUuid,
  body: z.string().max(CHAT_TEXT_MAX, "tooLong"),
  replyTo: zUuid.nullable(),
  /** Upload ticket from prepareChatFileAction when the message carries a file (D-035). */
  ticket: z.string().max(4096).nullable().default(null),
});

export type SendMessageInput = z.input<typeof sendSchema>;

const preview = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/** The chat must be in the current garden and writable by the user (can_write_chat: membership, lock, role). */
async function writableChat(ctx: KgContext, supabase: SupabaseClient, chatId: string) {
  const { data: chat } = await supabase.from("chats").select("id, kind, kindergarten_id, groups(name)").eq("id", chatId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
  if (!chat) throw new ActionError("forbidden");
  const { data: canWrite } = await supabase.rpc("can_write_chat", { p_chat: chatId });
  if (canWrite !== true) throw new ActionError("forbidden");
  return chat;
}

const chatPrefix = (ctx: KgContext, chatId: string) => `${ctx.kg.id}/${chatId}/`;

/** Step A of attaching a photo/PDF: permission + limits, then a signed upload URL for a server-chosen path. */
export async function prepareChatFileAction(chatId: string, file: DeclaredFile) {
  return kgAction(null, async (ctx, supabase): Promise<PreparedUpload> => {
    zUuid.parse(chatId);
    await writableChat(ctx, supabase, chatId);
    const prefix = chatPrefix(ctx, chatId);
    return prepareUpload("chat", ctx, { target: chatId, prefix, file, path: (ext, id) => `${prefix}${id}.${ext}` });
  });
}

/**
 * Sends a message (text and/or one photo/PDF already uploaded to storage with prepareChatFileAction). The
 * message row is inserted as the user (RLS decides whether they may write here); the file is verified in
 * storage and its row is written by the server.
 */
export async function sendMessageAction(input: SendMessageInput) {
  return kgAction(null, async (ctx, supabase) => {
    const v = parse(sendSchema, input);
    const body = v.body.trim();
    if (!body && !v.ticket) throw new ActionError("invalid");
    const chat = await writableChat(ctx, supabase, v.chatId);

    const service = createServiceClient();
    // Verifies the ticket and the stored object (size, real type); a bad object is removed.
    const file = v.ticket ? await commitUpload("chat", ctx, v.ticket, { target: v.chatId, prefix: chatPrefix(ctx, v.chatId) }) : null;
    const ins = await supabase
      .from("messages")
      .insert({ id: v.id, kindergarten_id: ctx.kg.id, chat_id: v.chatId, author_id: ctx.userId, body, reply_to: v.replyTo })
      .select("id")
      .single();
    if (ins.error) {
      if (file) await service.storage.from(BUCKET).remove([file.path]);
      if (ins.error.code === "23505") {
        // A retry of a message that already went through (same client id): return it, notify nobody again.
        const { data: same } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).eq("author_id", ctx.userId).maybeSingle();
        if (same) return toMessage(same as never);
      }
      check(ins);
    }
    if (file) {
      // Permission checked above (can_write_chat + RLS insert of the message); rows are written by the server only.
      const f = await service.from("message_files").insert({
        kindergarten_id: ctx.kg.id,
        chat_id: v.chatId,
        message_id: v.id,
        kind: file.ext === "pdf" ? "pdf" : "photo",
        path: file.path,
        name: file.name,
        mime: file.mime,
        size: file.size,
      });
      if (f.error) {
        console.error("message_files", f.error.message);
        if (f.error.code !== "23505") await service.storage.from(BUCKET).remove([file.path]);
      }
    }

    const { data: row } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).single();
    const message = toMessage(row as never);

    // Staff written to from the parent side during quiet hours get the bell row now, the push in the morning.
    const { data: targets } = await service.rpc("chat_notify_targets", { p_chat: v.chatId, p_author: ctx.userId });
    const groupName = (chat as unknown as { groups: { name: string } | null }).groups?.name;
    const byDelivery = new Map<string | null, string[]>();
    for (const t of (targets ?? []) as { user_id: string; deliver_after: string | null }[]) {
      if (t.user_id === ctx.userId) continue;
      byDelivery.set(t.deliver_after, [...(byDelivery.get(t.deliver_after) ?? []), t.user_id]);
    }
    for (const [deliverAfter, userIds] of byDelivery) {
      await notify({
        kindergartenId: ctx.kg.id,
        userIds,
        type: "message.new",
        params: {
          from: groupName ? `${ctx.profile.full_name} · ${groupName}` : ctx.profile.full_name,
          text: preview(body || (file?.name ?? "")),
          // delete_chat_message() strips the text of this row when the message is removed
          message_id: v.id,
        },
        url: `/chats/${v.chatId}`,
        deliverAfter,
      });
    }
    return message;
  });
}

export async function editMessageAction(id: string, body: string) {
  return kgAction(null, async (ctx, supabase) => {
    zUuid.parse(id);
    const text = parse(z.string().trim().min(1, "required").max(CHAT_TEXT_MAX, "tooLong"), body);
    const rows = check(await supabase.from("messages").update({ body: text }).eq("id", id).eq("kindergarten_id", ctx.kg.id).select(MESSAGE_COLUMNS));
    if (!rows.length) throw new ActionError("forbidden");
    return toMessage(rows[0] as never);
  });
}

/** Author removes own message; owner/head moderate group chats (audited in SQL). Files are removed from storage. */
export async function deleteMessageAction(id: string) {
  return kgAction(null, async (_ctx, supabase) => {
    zUuid.parse(id);
    const paths = check(await supabase.rpc("delete_chat_message", { p_id: id })) as unknown as string[];
    if (paths?.length) await createServiceClient().storage.from(BUCKET).remove(paths);
  });
}

export async function markChatReadAction(chatId: string) {
  return kgAction(null, async (_ctx, supabase) => {
    zUuid.parse(chatId);
    check(await supabase.rpc("mark_chat_read", { p_chat: chatId }));
  });
}

/** "Только сотрудники пишут" for a group chat (owner/head). */
export async function setParentsCanWriteAction(chatId: string, value: boolean) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(chatId);
    const rows = check(
      await supabase.from("chats").update({ parents_can_write: value }).eq("id", chatId).eq("kindergarten_id", ctx.kg.id).eq("kind", "group").select("id, group_id"),
    );
    if (!rows.length) throw new ActionError("forbidden");
    await audit(supabase, ctx.kg.id, value ? "chat.unlock" : "chat.lock", "chat", chatId, { group_id: rows[0].group_id });
  });
}

/** Opens (or creates) a direct chat. Parent ↔ parent and other forbidden pairs are rejected in SQL. */
export async function startDirectChatAction(userId: string) {
  return kgAction(null, async (ctx, supabase) => {
    zUuid.parse(userId);
    const id = check(await supabase.rpc("start_direct_chat", { p_kg: ctx.kg.id, p_other: userId })) as unknown as string;
    return { id };
  });
}

export interface ChatContact {
  user_id: string;
  full_name: string;
  role: string;
  hint: string | null;
}

export async function chatContactsAction() {
  return kgAction(null, async (ctx, supabase) => {
    return check(await supabase.rpc("chat_contacts", { p_kg: ctx.kg.id })) as unknown as ChatContact[];
  });
}

export async function chatListAction() {
  return kgAction(null, async (ctx, supabase): Promise<ChatSummary[]> => loadChatList(supabase, ctx));
}

/** Header badge refresh (live, see components/chats/live-unread.ts). */
export async function unreadTotalAction() {
  return kgAction(null, async (ctx, supabase): Promise<number> => unreadTotal(supabase, ctx));
}

export async function olderMessagesAction(chatId: string, before: string) {
  return kgAction(null, async (_ctx, supabase): Promise<{ messages: ChatMessage[]; quotes: ChatMessage[]; hasMore: boolean }> => {
    zUuid.parse(chatId);
    z.string().datetime({ offset: true }).parse(before);
    const page = await loadMessages(supabase, chatId, before);
    return { ...page, quotes: await loadQuotes(supabase, page.messages) };
  });
}

/** The newest page — the conversation catches up with it once its realtime channel has joined. */
export async function latestMessagesAction(chatId: string) {
  return kgAction(null, async (_ctx, supabase): Promise<{ messages: ChatMessage[]; quotes: ChatMessage[] }> => {
    zUuid.parse(chatId);
    const page = await loadMessages(supabase, chatId);
    return { messages: page.messages, quotes: await loadQuotes(supabase, page.messages) };
  });
}

/** Messages by id (a realtime event arrived; re-read with files under RLS). */
export async function messagesByIdAction(ids: string[]) {
  return kgAction(null, async (_ctx, supabase): Promise<ChatMessage[]> => {
    const list = z.array(zUuid).max(100).parse(ids);
    if (!list.length) return [];
    const { data } = await supabase.from("messages").select(MESSAGE_COLUMNS).in("id", list);
    return ((data ?? []) as never[]).map(toMessage);
  });
}

export async function participantsAction(chatId: string) {
  return kgAction(null, async (_ctx, supabase): Promise<ChatPerson[]> => {
    zUuid.parse(chatId);
    return loadParticipants(supabase, chatId);
  });
}

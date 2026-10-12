"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/service";
import { zUuid } from "@/lib/validation";
import { CHAT_FILE_MAX, CHAT_FILE_TYPES, CHAT_TEXT_MAX, type ChatMessage, type ChatPerson, type ChatSummary } from "@/lib/chats-logic";
import { MESSAGE_COLUMNS, loadChatList, loadMessages, loadParticipants, loadQuotes, toMessage } from "@/lib/chats";

const BUCKET = "chat-files";

const sendSchema = z.object({
  chatId: zUuid,
  id: zUuid,
  body: z.string().max(CHAT_TEXT_MAX, "tooLong"),
  replyTo: zUuid.nullable(),
});

const preview = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/**
 * Sends a message (text and/or one photo/PDF). The message row is inserted as the user (RLS decides
 * whether they may write here); the file goes to private storage and its row is written by the server.
 */
export async function sendMessageAction(form: FormData) {
  return kgAction(null, async (ctx, supabase) => {
    const replyRaw = String(form.get("replyTo") ?? "");
    const v = parse(sendSchema, {
      chatId: String(form.get("chatId") ?? ""),
      id: String(form.get("id") ?? ""),
      body: String(form.get("body") ?? ""),
      replyTo: replyRaw || null,
    });
    const body = v.body.trim();
    const file = form.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (!body && !hasFile) throw new ActionError("invalid");
    let ext: string | undefined;
    if (hasFile) {
      if (file.size > CHAT_FILE_MAX) throw new ActionError("fileTooLarge");
      ext = CHAT_FILE_TYPES[file.type];
      if (!ext) throw new ActionError("fileType");
    }
    const { data: chat } = await supabase.from("chats").select("id, kind, kindergarten_id, groups(name)").eq("id", v.chatId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!chat) throw new ActionError("forbidden");
    const { data: canWrite } = await supabase.rpc("can_write_chat", { p_chat: v.chatId });
    if (canWrite !== true) throw new ActionError("forbidden");

    const service = createServiceClient();
    let path: string | null = null;
    if (hasFile) {
      path = `${ctx.kg.id}/${v.chatId}/${randomUUID()}.${ext}`;
      const up = await service.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw new ActionError("generic");
    }
    const ins = await supabase
      .from("messages")
      .insert({ id: v.id, kindergarten_id: ctx.kg.id, chat_id: v.chatId, author_id: ctx.userId, body, reply_to: v.replyTo })
      .select("id")
      .single();
    if (ins.error) {
      if (path) await service.storage.from(BUCKET).remove([path]);
      if (ins.error.code === "23505") {
        // A retry of a message that already went through (same client id): return it, notify nobody again.
        const { data: same } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).eq("author_id", ctx.userId).maybeSingle();
        if (same) return toMessage(same as never);
      }
      check(ins);
    }
    if (hasFile && path) {
      // Permission checked above (can_write_chat + RLS insert of the message); rows are written by the server only.
      const f = await service.from("message_files").insert({
        kindergarten_id: ctx.kg.id,
        chat_id: v.chatId,
        message_id: v.id,
        kind: ext === "pdf" ? "pdf" : "photo",
        path,
        name: (file.name || `file.${ext}`).slice(0, 200),
        mime: file.type,
        size: file.size,
      });
      if (f.error) {
        console.error("message_files", f.error.message);
        await service.storage.from(BUCKET).remove([path]);
      }
    }

    const { data: row } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).single();
    const message = toMessage(row as never);

    const { data: targets } = await service.rpc("chat_notify_targets", { p_chat: v.chatId, p_author: ctx.userId });
    const groupName = (chat as unknown as { groups: { name: string } | null }).groups?.name;
    await notify({
      kindergartenId: ctx.kg.id,
      userIds: ((targets ?? []) as string[]).filter((u) => u !== ctx.userId),
      type: "message.new",
      params: {
        from: groupName ? `${ctx.profile.full_name} · ${groupName}` : ctx.profile.full_name,
        text: preview(body || (hasFile ? (file as File).name : "")),
      },
      url: `/chats/${v.chatId}`,
    });
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

export async function olderMessagesAction(chatId: string, before: string) {
  return kgAction(null, async (_ctx, supabase): Promise<{ messages: ChatMessage[]; quotes: ChatMessage[]; hasMore: boolean }> => {
    zUuid.parse(chatId);
    z.string().datetime({ offset: true }).parse(before);
    const page = await loadMessages(supabase, chatId, before);
    return { ...page, quotes: await loadQuotes(supabase, page.messages) };
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

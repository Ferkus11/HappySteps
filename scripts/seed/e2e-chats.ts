/**
 * Fixtures for chats (stage 3A): a short conversation in the group chat «Солнышко», a couple of
 * messages in the staff chat of garden A and one message in garden B (isolation tests).
 * Idempotent: a chat that already has messages is left untouched.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string; B: string };
  groups: { gA1: string; gB1: string };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function seedChat(db: SupabaseClient, chatId: string, kg: string, rows: { author: string; body: string; at: string }[]) {
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
  if (count) return;
  must(
    await db
      .from("messages")
      .insert(rows.map((r) => ({ kindergarten_id: kg, chat_id: chatId, author_id: r.author, body: r.body, created_at: r.at })))
      .select("id"),
    "messages",
  );
}

export async function seedChats(db: SupabaseClient, ids: Ids) {
  const { users: u } = ids;
  const { A, B } = ids.kindergartens;
  const chat = async (q: Record<string, string>) =>
    must(await db.from("chats").select("id").match(q).single(), "chat").id as string;

  const sun = await chat({ kind: "group", group_id: ids.groups.gA1 });
  const staffA = await chat({ kind: "staff", kindergarten_id: A });
  const romashka = await chat({ kind: "group", group_id: ids.groups.gB1 });

  await seedChat(db, sun, A, [
    { author: u.teacher, body: "Добрый вечер! Завтра идём на прогулку в парк — оденьте, пожалуйста, детей потеплее.", at: ago(60 * 20) },
    { author: u.parent, body: "Спасибо, поняли! Шапку положим в шкафчик.", at: ago(60 * 19) },
    { author: u.teacher, body: "Доброе утро! Все на месте, завтракаем 😊", at: ago(90) },
  ]);
  await seedChat(db, staffA, A, [
    { author: u.head, body: "Коллеги, планёрка в пятницу в 13:30 в методическом кабинете.", at: ago(60 * 26) },
    { author: u.cook, body: "Завтра на обед плов, на полдник — сырники.", at: ago(60 * 3) },
  ]);
  await seedChat(db, romashka, B, [{ author: u.ownerB, body: "Добро пожаловать в чат группы «Ромашка»!", at: ago(60 * 5) }]);

  // The authors have read their chats.
  await db.from("chat_reads").upsert([
    { chat_id: sun, user_id: u.teacher, kindergarten_id: A, last_read_at: new Date().toISOString() },
    { chat_id: staffA, user_id: u.head, kindergarten_id: A, last_read_at: new Date().toISOString() },
  ]);
}

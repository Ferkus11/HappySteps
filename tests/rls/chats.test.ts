import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin, asUser, inTx, rejects } from "./db";
import { fx, PHONES, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
let chat: { sun: string; stars: string; staffA: string; staffB: string; romashka: string };

beforeAll(async () => {
  F = await fx();
  chat = await admin(async (c) => {
    const one = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows[0].id as string;
    return {
      sun: await one("select id from chats where kind = 'group' and group_id = $1", [F.gA1]),
      stars: await one("select id from chats where kind = 'group' and group_id = $1", [F.gA2]),
      staffA: await one("select id from chats where kind = 'staff' and kindergarten_id = $1", [F.A]),
      staffB: await one("select id from chats where kind = 'staff' and kindergarten_id = $1", [F.B]),
      romashka: await one("select c.id from chats c join groups g on g.id = c.group_id where g.kindergarten_id = $1 and g.name = 'Ромашка'", [F.B]),
    };
  });
});

const ALL: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent", "ownerB", "parentB"];
type Become = (u: string | null) => Promise<void>;

const sees = async (c: PoolClient, id: string) => (await c.query("select 1 from chats where id = $1", [id])).rowCount === 1;

async function visibility(c: PoolClient, become: Become, id: string) {
  const out: Partial<Record<Who, boolean>> = {};
  for (const w of ALL) {
    await become(F.users[w]);
    out[w] = await sees(c, id);
  }
  await c.query("reset role");
  return out;
}

async function post(c: PoolClient, become: Become, who: Who, chatId: string, body: string, kg = F.A) {
  await become(F.users[who]);
  const r = await c.query("insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, $4) returning id", [kg, chatId, F.users[who], body]);
  return r.rows[0].id as string;
}

async function startDirect(c: PoolClient, become: Become, who: Who, other: Who, kg = F.A) {
  await become(F.users[who]);
  const r = await c.query("select public.start_direct_chat($1, $2) as id", [kg, F.users[other]]);
  return r.rows[0].id as string;
}

describe("chats · membership computed from the source tables", () => {
  it("every garden has a staff chat and every group a group chat (created automatically)", async () => {
    await inTx(async (c) => {
      const g = await c.query("insert into groups (kindergarten_id, name) values ($1, 'Тестовая') returning id", [F.A]);
      expect((await c.query("select 1 from chats where kind = 'group' and group_id = $1", [g.rows[0].id])).rowCount).toBe(1);
      const k = await c.query("insert into kindergartens (name, slug) values ('Тест сад', 'zz-chat-test') returning id");
      expect((await c.query("select 1 from chats where kind = 'staff' and kindergarten_id = $1", [k.rows[0].id])).rowCount).toBe(1);
    });
  });

  it("group chat: owner, head, teachers of the group and parents of children in it", async () => {
    await inTx(async (c, become) => {
      expect(await visibility(c, become, chat.sun)).toEqual({
        owner: true, head: true, accountant: false, teacher: true, clubTeacher: false, cook: false,
        parent: true, teacherParent: true /* parent of Миша */, ownerB: false, parentB: false,
      });
      expect(await visibility(c, become, chat.stars)).toEqual({
        owner: true, head: true, accountant: false, teacher: false, clubTeacher: false, cook: false,
        parent: false, teacherParent: true /* teacher of Звёздочки */, ownerB: false, parentB: false,
      });
    });
  });

  it("staff chat: every active staff member, no parents, no other garden", async () => {
    await inTx(async (c, become) => {
      expect(await visibility(c, become, chat.staffA)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: true,
        parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
    });
  });

  it("messages and files follow the chat; other garden and anon see nothing", async () => {
    await inTx(async (c, become) => {
      const id = await post(c, become, "teacher", chat.sun, "Проверка");
      await c.query("reset role");
      await c.query("insert into message_files (kindergarten_id, chat_id, message_id, kind, path, name, mime, size) values ($1, $2, $3, 'pdf', $4, 'a.pdf', 'application/pdf', 10)", [
        F.A, chat.sun, id, `${F.A}/${chat.sun}/x.pdf`,
      ]);
      for (const w of ALL) {
        await become(F.users[w]);
        const member = !["accountant", "clubTeacher", "cook", "ownerB", "parentB"].includes(w);
        expect((await c.query("select 1 from messages where id = $1", [id])).rowCount, w).toBe(member ? 1 : 0);
        expect((await c.query("select 1 from message_files where message_id = $1", [id])).rowCount, w).toBe(member ? 1 : 0);
      }
      await become(F.users.ownerB);
      expect((await c.query("select 1 from messages where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
      await become(null);
      for (const t of ["chats", "messages", "message_files", "chat_reads"]) {
        expect((await c.query(`select 1 from ${t}`)).rowCount, t).toBe(0);
      }
      expect(await rejects(c, "select public.chat_list($1)", [F.A])).toBe(true);
    });
  });

  it("transferred child: the parent loses the old group chat and joins the new one", async () => {
    await inTx(async (c, become) => {
      await c.query("update children set group_id = $1 where id = $2", [F.gA2, F.children["Алихан"]]);
      await become(F.users.parent);
      expect(await sees(c, chat.sun)).toBe(false);
      expect(await sees(c, chat.stars)).toBe(true);
      expect((await c.query("select 1 from messages where chat_id = $1", [chat.sun])).rowCount).toBe(0);
    });
  });

  it("archived child, unlinked parent: no access", async () => {
    await inTx(async (c, become) => {
      await c.query("update children set status = 'archived', archived_at = now() where id = $1", [F.children["Миша"]]);
      await become(F.users.teacherParent);
      expect(await sees(c, chat.sun)).toBe(false);
      expect(await sees(c, chat.stars)).toBe(true); // still teaches Звёздочки
    });
    await inTx(async (c, become) => {
      await c.query("delete from child_guardians where child_id = $1 and user_id = $2", [F.children["Алихан"], F.users.parent]);
      await become(F.users.parent);
      expect(await sees(c, chat.sun)).toBe(false);
    });
  });

  it("archived teacher or a teacher removed from the group loses access", async () => {
    await inTx(async (c, become) => {
      await c.query("update memberships set status = 'archived' where user_id = $1 and kindergarten_id = $2", [F.users.teacher, F.A]);
      await become(F.users.teacher);
      expect(await sees(c, chat.sun)).toBe(false);
      expect(await sees(c, chat.staffA)).toBe(false);
      expect((await c.query("select 1 from messages where chat_id = $1", [chat.staffA])).rowCount).toBe(0);
    });
    await inTx(async (c, become) => {
      await c.query("delete from group_teachers where user_id = $1 and group_id = $2", [F.users.teacher, F.gA1]);
      await become(F.users.teacher);
      expect(await sees(c, chat.sun)).toBe(false);
      expect(await sees(c, chat.staffA)).toBe(true);
      // and a newly assigned teacher gets it at once
      await c.query("reset role");
      await c.query("insert into group_teachers (group_id, user_id, kindergarten_id) values ($1, $2, $3)", [F.gA1, F.users.teacherParent, F.A]);
      await become(F.users.teacherParent);
      expect(await sees(c, chat.sun)).toBe(true);
    });
  });
});

describe("chats · direct chats", () => {
  it("parent may start only with teachers of own child's group, head and owner", async () => {
    await inTx(async (c, become) => {
      const t = await startDirect(c, become, "parent", "teacher");
      expect(t).toBeTruthy();
      // idempotent: the same chat is returned, from either side
      expect(await startDirect(c, become, "parent", "teacher")).toBe(t);
      expect(await startDirect(c, become, "teacher", "parent")).toBe(t);
      expect(await startDirect(c, become, "parent", "head")).toBeTruthy();
      expect(await startDirect(c, become, "parent", "owner")).toBeTruthy();
      await become(F.users.parent);
      for (const other of ["accountant", "cook", "clubTeacher", "teacherParent" /* teaches another group */, "parentB", "ownerB"] as Who[]) {
        expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.A, F.users[other]]), other).toBe(true);
      }
      // chat_contacts offers exactly the allowed people
      const contacts = (await c.query("select user_id from public.chat_contacts($1)", [F.A])).rows.map((r) => r.user_id).sort();
      expect(contacts).toEqual([F.users.owner, F.users.head, F.users.teacher].sort());
    });
  });

  it("parent ↔ parent is impossible: no RPC, no direct insert", async () => {
    await inTx(async (c, become) => {
      // make the teacher-parent a parent only
      await c.query("update memberships set status = 'archived' where user_id = $1 and kindergarten_id = $2 and role = 'teacher'", [F.users.teacherParent, F.A]);
      await become(F.users.parent);
      expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.A, F.users.teacherParent])).toBe(true);
      const [a, b] = [F.users.parent, F.users.teacherParent].sort();
      expect(await rejects(c, "insert into chats (kindergarten_id, kind, user_a, user_b) values ($1, 'direct', $2, $3)", [F.A, a, b])).toBe(true);
      await become(F.users.teacherParent);
      expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.A, F.users.parent])).toBe(true);
      expect((await c.query("select user_id from public.chat_contacts($1) where user_id = $2", [F.A, F.users.parent])).rowCount).toBe(0);
      // even a chat row forged by a superuser cannot be written to (no staff side)
      await c.query("reset role");
      const forged = await c.query("insert into chats (kindergarten_id, kind, user_a, user_b) values ($1, 'direct', $2, $3) returning id", [F.A, a, b]);
      await become(F.users.parent);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'привет')", [F.A, forged.rows[0].id, F.users.parent])).toBe(true);
    });
  });

  it("staff may start a chat with any parent or colleague of the garden, never across gardens", async () => {
    await inTx(async (c, become) => {
      expect(await startDirect(c, become, "cook", "parent")).toBeTruthy();
      expect(await startDirect(c, become, "accountant", "clubTeacher")).toBeTruthy();
      await become(F.users.owner);
      expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.A, F.users.parentB])).toBe(true);
      expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.B, F.users.parentB])).toBe(true);
      expect(await rejects(c, "select public.start_direct_chat($1, $2)", [F.A, F.users.owner])).toBe(true); // self
    });
  });

  it("only the two participants see a direct chat; read markers of the other side are visible there", async () => {
    await inTx(async (c, become) => {
      const id = await startDirect(c, become, "parent", "teacher");
      const v = await visibility(c, become, id);
      expect(Object.entries(v).filter(([, x]) => x).map(([k]) => k).sort()).toEqual(["parent", "teacher"]);
      await post(c, become, "parent", id, "Здравствуйте!");
      await become(F.users.teacher);
      await c.query("select public.mark_chat_read($1)", [id]);
      await become(F.users.parent);
      expect((await c.query("select 1 from chat_reads where chat_id = $1 and user_id = $2", [id, F.users.teacher])).rowCount).toBe(1);
      // in a group chat read markers of others stay private
      await become(F.users.teacher);
      await c.query("select public.mark_chat_read($1)", [chat.sun]);
      await become(F.users.parent);
      expect((await c.query("select 1 from chat_reads where chat_id = $1 and user_id = $2", [chat.sun, F.users.teacher])).rowCount).toBe(0);
      expect(await rejects(c, "insert into chat_reads (chat_id, user_id, kindergarten_id) values ($1, $2, $3)", [chat.sun, F.users.parent, F.A])).toBe(true);
      // a direct chat with a parent of another garden cannot be read by them even if forged
      await become(F.users.parentB);
      expect(await sees(c, id)).toBe(false);
    });
  });
});

describe("chats · writing, editing, moderation", () => {
  it("members write; non-members, forged authors and other gardens are rejected", async () => {
    await inTx(async (c, become) => {
      expect(await post(c, become, "parent", chat.sun, "Добрый день")).toBeTruthy();
      expect(await post(c, become, "teacherParent", chat.sun, "Здравствуйте")).toBeTruthy();
      await become(F.users.cook);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.A, chat.sun, F.users.cook])).toBe(true);
      await become(F.users.parent);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.A, chat.sun, F.users.teacher])).toBe(true);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.A, chat.staffA, F.users.parent])).toBe(true);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.B, chat.romashka, F.users.parent])).toBe(true);
      // service columns cannot be set by clients
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body, deleted_at) values ($1, $2, $3, 'x', now())", [F.A, chat.sun, F.users.parent])).toBe(true);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, $4)", [F.A, chat.sun, F.users.parent, "я".repeat(4001)])).toBe(true);
    });
  });

  it("reply must point into the same chat", async () => {
    await inTx(async (c, become) => {
      const staffMsg = await post(c, become, "teacher", chat.staffA, "Только для сотрудников");
      const ok = await post(c, become, "teacher", chat.sun, "Вопрос");
      await become(F.users.parent);
      await c.query("insert into messages (kindergarten_id, chat_id, author_id, body, reply_to) values ($1, $2, $3, 'Ответ', $4)", [F.A, chat.sun, F.users.parent, ok]);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body, reply_to) values ($1, $2, $3, 'x', $4)", [F.A, chat.sun, F.users.parent, staffMsg])).toBe(true);
    });
  });

  it("authors edit only their own messages; nobody edits service columns", async () => {
    await inTx(async (c, become) => {
      const t = await post(c, become, "teacher", chat.sun, "Исходный текст");
      await become(F.users.parent);
      expect((await c.query("update messages set body = 'взлом' where id = $1", [t])).rowCount).toBe(0);
      await become(F.users.head);
      expect((await c.query("update messages set body = 'взлом' where id = $1", [t])).rowCount).toBe(0);
      expect(await rejects(c, "update messages set deleted_at = now(), deleted_by = $2 where id = $1", [t, F.users.head])).toBe(true);
      await become(F.users.teacher);
      expect((await c.query("update messages set body = 'Исправленный текст' where id = $1", [t])).rowCount).toBe(1);
      expect((await c.query("select edited_at from messages where id = $1", [t])).rows[0].edited_at).not.toBeNull();
      expect(await rejects(c, "delete from messages where id = $1", [t])).toBe(true);
    });
  });

  it("files are written by the server only", async () => {
    await inTx(async (c, become) => {
      const id = await post(c, become, "parent", chat.sun, "Фото");
      expect(
        await rejects(c, "insert into message_files (kindergarten_id, chat_id, message_id, kind, path, name, mime, size) values ($1, $2, $3, 'photo', $4, 'a.jpg', 'image/jpeg', 10)", [
          F.A, chat.sun, id, `${F.A}/${chat.sun}/x.jpg`,
        ]),
      ).toBe(true);
      // even the server cannot point a row outside <garden>/<chat>/
      await c.query("reset role");
      expect(
        await rejects(c, "insert into message_files (kindergarten_id, chat_id, message_id, kind, path, name, mime, size) values ($1, $2, $3, 'photo', $4, 'a.jpg', 'image/jpeg', 10)", [
          F.A, chat.sun, id, `${F.A}/${chat.staffA}/x.jpg`,
        ]),
      ).toBe(true);
    });
  });

  it("owner/head delete any message of a group chat (audited); authors delete their own; others cannot", async () => {
    await inTx(async (c, become) => {
      const p = await post(c, become, "parent", chat.sun, "Неуместное сообщение");
      await c.query("reset role");
      await c.query("insert into message_files (kindergarten_id, chat_id, message_id, kind, path, name, mime, size) values ($1, $2, $3, 'photo', $4, 'a.jpg', 'image/jpeg', 10)", [
        F.A, chat.sun, p, `${F.A}/${chat.sun}/del.jpg`,
      ]);
      await become(F.users.teacher);
      expect(await rejects(c, "select public.delete_chat_message($1)", [p])).toBe(true);
      await become(F.users.head);
      const paths = (await c.query("select public.delete_chat_message($1) as path", [p])).rows.map((r) => r.path);
      expect(paths).toEqual([`${F.A}/${chat.sun}/del.jpg`]);
      const row = (await c.query("select body, deleted_at, deleted_by, author_id from messages where id = $1", [p])).rows[0];
      expect(row.body).toBe("");
      expect(row.deleted_at).not.toBeNull();
      expect(row.deleted_by).toBe(F.users.head);
      expect((await c.query("select 1 from message_files where message_id = $1", [p])).rowCount).toBe(0);
      expect((await c.query("select 1 from audit_log where action = 'chat.message_delete' and entity_id = $1", [p])).rowCount).toBe(1);
      // the parent still sees the (empty) placeholder row
      await become(F.users.parent);
      expect((await c.query("select deleted_by from messages where id = $1", [p])).rows[0].deleted_by).toBe(F.users.head);
      // own message
      const own = await post(c, become, "parent", chat.sun, "Опечатка");
      await c.query("select public.delete_chat_message($1)", [own]);
      expect((await c.query("select deleted_by from messages where id = $1", [own])).rows[0].deleted_by).toBe(F.users.parent);
      // moderation is for group chats only
      const s = await post(c, become, "cook", chat.staffA, "Сообщение повара");
      await become(F.users.head);
      expect(await rejects(c, "select public.delete_chat_message($1)", [s])).toBe(true);
    });
  });

  it("«только сотрудники пишут»: parents read but cannot post; only owner/head switch it", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect((await c.query("update chats set parents_can_write = false where id = $1", [chat.sun])).rowCount).toBe(0);
      await become(F.users.parent);
      expect((await c.query("update chats set parents_can_write = false where id = $1", [chat.sun])).rowCount).toBe(0);
      await become(F.users.head);
      expect((await c.query("update chats set parents_can_write = false where id = $1", [chat.sun])).rowCount).toBe(1);
      expect((await c.query("update chats set parents_can_write = false where id = $1", [chat.staffA])).rowCount).toBe(0);
      expect(await rejects(c, "update chats set group_id = $2 where id = $1", [chat.sun, F.gA2])).toBe(true);
      await become(F.users.parent);
      expect(await sees(c, chat.sun)).toBe(true);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.A, chat.sun, F.users.parent])).toBe(true);
      expect((await c.query("select public.can_write_chat($1) as w", [chat.sun])).rows[0].w).toBe(false);
      // the teacher-parent is on the parent side in this chat
      await become(F.users.teacherParent);
      expect(await rejects(c, "insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, 'x')", [F.A, chat.sun, F.users.teacherParent])).toBe(true);
      expect(await post(c, become, "teacher", chat.sun, "Объявление")).toBeTruthy();
      expect(await post(c, become, "owner", chat.sun, "Объявление владельца")).toBeTruthy();
    });
  });
});

describe("chats · unread counters", () => {
  it("counts messages from others after the read marker; marking read clears the count and the chat's notifications", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      await c.query("select public.mark_chat_read($1)", [chat.sun]);
      await c.query("reset role");
      await c.query("update chat_reads set last_read_at = now() - interval '1 hour' where chat_id = $1 and user_id = $2", [chat.sun, F.users.parent]);
      await c.query("insert into notifications (kindergarten_id, user_id, type, url) values ($1, $2, 'message.new', $3)", [F.A, F.users.parent, `/chats/${chat.sun}`]);
      await post(c, become, "teacher", chat.sun, "Раз");
      await post(c, become, "teacher", chat.sun, "Два");
      await post(c, become, "parent", chat.sun, "Своё не считается");
      await become(F.users.parent);
      // (all rows of this transaction share one timestamp, so the "last message" is not asserted here)
      expect((await c.query("select unread from public.chat_list($1) where id = $2", [F.A, chat.sun])).rows[0].unread).toBe(2);
      expect((await c.query("select public.chat_unread_total($1) as n", [F.A])).rows[0].n).toBeGreaterThanOrEqual(2);
      await c.query("select public.mark_chat_read($1)", [chat.sun]);
      expect((await c.query("select unread from public.chat_list($1) where id = $2", [F.A, chat.sun])).rows[0].unread).toBe(0);
      expect((await c.query("select 1 from notifications where user_id = $1 and url = $2 and read_at is null", [F.users.parent, `/chats/${chat.sun}`])).rowCount).toBe(0);
      // the list holds only own chats
      const ids = (await c.query("select id from public.chat_list($1)", [F.A])).rows.map((r) => r.id);
      expect(ids).toContain(chat.sun);
      expect(ids).not.toContain(chat.staffA);
      expect(ids).not.toContain(chat.stars);
      expect((await c.query("select * from public.chat_list($1)", [F.B])).rowCount).toBe(0);
      // a parent cannot mark a chat read that is not theirs
      expect(await rejects(c, "select public.mark_chat_read($1)", [chat.staffA])).toBe(true);
    });
  });

  it("participants: parents see names of the other members only through their group chat", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const rows = (await c.query("select user_id, chat_role from public.chat_participants($1)", [chat.sun])).rows;
      const role = Object.fromEntries(rows.map((r) => [r.user_id, r.chat_role]));
      expect(role[F.users.teacher]).toBe("teacher");
      expect(role[F.users.head]).toBe("head");
      expect(role[F.users.teacherParent]).toBe("parent");
      expect(role[F.users.accountant]).toBeUndefined();
      expect((await c.query("select 1 from public.chat_participants($1)", [chat.staffA])).rowCount).toBe(0);
    });
  });
});

describe("chats · quiet hours and notification targets", () => {
  const at = (hhmm: string) => `2026-10-14T${hhmm}:00+05:00`; // Asia/Almaty

  it("kg_in_quiet_hours honours the overnight window and the garden time zone", async () => {
    await inTx(async (c) => {
      const q = async (t: string) => (await c.query("select public.kg_in_quiet_hours($1, $2) as q", [F.A, t])).rows[0].q;
      await c.query("update kindergarten_settings set quiet_hours_start = '21:00', quiet_hours_end = '08:00', timezone = 'Asia/Almaty' where kindergarten_id = $1", [F.A]);
      expect(await q(at("20:59"))).toBe(false);
      expect(await q(at("21:00"))).toBe(true);
      expect(await q(at("23:30"))).toBe(true);
      expect(await q(at("03:00"))).toBe(true);
      expect(await q(at("07:59"))).toBe(true);
      expect(await q(at("08:00"))).toBe(false);
      expect(await q(at("12:00"))).toBe(false);
      await c.query("update kindergarten_settings set quiet_hours_start = '13:00', quiet_hours_end = '15:00' where kindergarten_id = $1", [F.A]);
      expect(await q(at("14:00"))).toBe(true);
      expect(await q(at("22:00"))).toBe(false);
      await c.query("update kindergarten_settings set quiet_hours_start = '10:00', quiet_hours_end = '10:00' where kindergarten_id = $1", [F.A]);
      expect(await q(at("10:00"))).toBe(false);
    });
  });

  it("parent → staff messages are not notified during quiet hours; staff → parents always are", async () => {
    await inTx(async (c) => {
      await c.query("update kindergarten_settings set quiet_hours_start = '21:00', quiet_hours_end = '08:00' where kindergarten_id = $1", [F.A]);
      const s = async (author: Who, recipient: Who, t: string, chatId = chat.sun) =>
        (await c.query("select public.chat_quiet_suppressed($1, $2, $3, $4) as s", [chatId, F.users[author], F.users[recipient], t])).rows[0].s;
      expect(await s("parent", "teacher", at("22:30"))).toBe(true);
      expect(await s("parent", "head", at("06:00"))).toBe(true);
      expect(await s("parent", "teacher", at("12:00"))).toBe(false);
      expect(await s("parent", "teacherParent" /* a parent in this chat */, at("22:30"))).toBe(false);
      expect(await s("teacher", "parent", at("22:30"))).toBe(false);
      expect(await s("teacher", "head", at("22:30"))).toBe(false);
      expect(await s("cook", "head", at("22:30"), chat.staffA)).toBe(false);
    });
  });

  it("chat_notify_targets: other members, not the author, not current readers, one unread notification per chat", async () => {
    await inTx(async (c) => {
      // outside quiet hours for "now": a window that never matches
      await c.query("update kindergarten_settings set quiet_hours_start = '10:00', quiet_hours_end = '10:00' where kindergarten_id = $1", [F.A]);
      await c.query("delete from notifications where url = $1", [`/chats/${chat.sun}`]);
      await c.query("delete from chat_reads where chat_id = $1", [chat.sun]);
      const targets = async (author: Who) => (await c.query("select public.chat_notify_targets($1, $2) as u", [chat.sun, F.users[author]])).rows.map((r) => r.u).sort();
      expect(await targets("teacher")).toEqual([F.users.owner, F.users.head, F.users.parent, F.users.teacherParent].sort());
      await c.query("insert into chat_reads (chat_id, user_id, kindergarten_id, last_read_at) values ($1, $2, $3, now())", [chat.sun, F.users.parent, F.A]);
      await c.query("insert into notifications (kindergarten_id, user_id, type, url) values ($1, $2, 'message.new', $3)", [F.A, F.users.owner, `/chats/${chat.sun}`]);
      expect(await targets("teacher")).toEqual([F.users.head, F.users.teacherParent].sort());
      // quiet hours all day: parent writes → staff are skipped, the other parent is not
      await c.query("update kindergarten_settings set quiet_hours_start = '00:00', quiet_hours_end = '23:59' where kindergarten_id = $1", [F.A]);
      await c.query("delete from chat_reads where chat_id = $1", [chat.sun]);
      await c.query("delete from notifications where url = $1", [`/chats/${chat.sun}`]);
      const late = await targets("parent");
      expect(late).toEqual([F.users.teacherParent]);
    });
  });

  it("internal helpers are not callable by clients", async () => {
    await asUser(F.users.parent, async (c) => {
      expect(await rejects(c, "select public.chat_notify_targets($1, $2)", [chat.sun, F.users.parent])).toBe(true);
      expect(await rejects(c, "select public.chat_member($1, $2)", [chat.staffA, F.users.teacher])).toBe(true);
      expect(await rejects(c, "select public.chat_member_ids($1)", [chat.sun])).toBe(true);
      expect(await rejects(c, "select public.chat_may_start($1, $2, $3)", [F.A, F.users.teacher, F.users.parent])).toBe(true);
    });
  });
});

// Scenario 8 at the database level: a teacher's message reaches the parent through Realtime, not the cook.
describe("chats · realtime delivery respects membership", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
  const clients: SupabaseClient[] = [];
  const marker = `RT-${Date.now()}`;

  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels();
    await admin((c) => c.query("delete from messages where body like $1", [`${marker}%`]));
  });

  async function listen(phone: string) {
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(c);
    const { error } = await c.auth.signInWithPassword({ email: `${phone.replace(/\D/g, "")}@${domain}`, password: "Test1234!" });
    if (error) throw error;
    const got: string[] = [];
    await new Promise<void>((resolve, reject) =>
      c
        .channel(`chat-${phone}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.sun}` }, (p) => got.push((p.new as { body: string }).body))
        .subscribe((s, e) => (s === "SUBSCRIBED" ? resolve() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? reject(e ?? new Error(s)) : undefined)),
    );
    return got;
  }

  it("parent receives the teacher's message, the cook and garden B do not", async () => {
    const parent = await listen(PHONES.parent);
    const cook = await listen(PHONES.cook);
    const parentB = await listen(PHONES.parentB);
    await admin((c) =>
      c.query("insert into messages (kindergarten_id, chat_id, author_id, body) values ($1, $2, $3, $4)", [F.A, chat.sun, F.users.teacher, `${marker} привет`]),
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(parent).toEqual([`${marker} привет`]);
    expect(cook).toEqual([]);
    expect(parentB).toEqual([]);
  });
});

/** Demo: announcements with reads and files, events, group / staff / direct chats with read markers. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { gradientPng } from "./e2e-clubs";
import { tinyPdf } from "./e2e-documents";
import { ANNOUNCEMENTS, EVENTS, GROUP_CHAT, STAFF_CHAT } from "./demo-content";
import { addDays, at, check, hm, insertMany, upload, uuid, weekday } from "./demo-lib";
import { activeIn, type Staff, type World } from "./demo-world";

type Row = Record<string, unknown>;

/** Active members now: id → is staff. */
function audience(w: World, aud: "all" | "groups" | "staff", groupKeys: string[] = []): string[] {
  const staff = w.staff.filter((s) => s.roles.length && !s.archivedOn);
  const ids = new Set<string>();
  const parentsOf = (keys: string[]) =>
    w.children.filter((c) => !c.leave && keys.includes(c.group)).flatMap((c) => c.family.parents.map((p) => p.id));
  if (aud === "staff") staff.forEach((s) => ids.add(s.id));
  if (aud === "all") {
    staff.forEach((s) => ids.add(s.id));
    parentsOf([...w.groups.keys()]).forEach((id) => ids.add(id));
  }
  if (aud === "groups") {
    staff.filter((s) => s.roles.some((r) => r === "owner" || r === "head" || r === "accountant")).forEach((s) => ids.add(s.id));
    staff.filter((s) => s.roles.includes("teacher") && s.groups.some((g) => groupKeys.includes(g))).forEach((s) => ids.add(s.id));
    parentsOf(groupKeys).forEach((id) => ids.add(id));
  }
  return [...ids];
}

export interface SocialResult {
  announcements: { id: string; title: string; created: string; important: boolean; aud: string[]; readers: Set<string> }[];
  directWithTeacher: string;
  messageIds: { id: string; chat: string; author: Staff | { id: string; name: string }; body: string; at: string; to: string[] }[];
}

export async function seedAnnouncements(db: SupabaseClient, w: World): Promise<SocialResult["announcements"]> {
  const rng = w.rng;
  const kg = w.kgId;
  const now = Date.now();
  const anns: Row[] = [];
  const links: Row[] = [];
  const reads: Row[] = [];
  const files: Row[] = [];
  const out: SocialResult["announcements"] = [];
  const authorOf = (a: (typeof ANNOUNCEMENTS)[number]) => (a.author === "teacher" ? w.s.teacher : w.s[a.author]);
  for (const a of ANNOUNCEMENTS) {
    const id = uuid();
    const created = at(addDays(w.today, -a.daysAgo), a.daysAgo === 0 ? hm(Math.min(w.nowMin - 30, toMin(a.time))) : a.time);
    const author = authorOf(a);
    anns.push({ id, kindergarten_id: kg, author_id: author.id, audience: a.audience, title: a.title, body: a.body, important: !!a.important, created_at: created, updated_at: created });
    for (const g of a.groups ?? []) links.push({ announcement_id: id, group_id: w.groups.get(g)!.id, kindergarten_id: kg });
    const aud = audience(w, a.audience, a.groups);
    const readers = new Set<string>([author.id]);
    for (const uid of aud) if (rng.chance(a.readShare)) readers.add(uid);
    // The demo logins: the parent has not opened the newest important one yet; the teacher — the staff meeting.
    const demoParent = w.demoParent.parents[0].id;
    if (aud.includes(demoParent)) {
      if (a.key === "matinee") readers.delete(demoParent);
      else readers.add(demoParent);
    }
    if (a.key === "meeting") readers.delete(w.s.teacher.id);
    else if (aud.includes(w.s.teacher.id) && a.key !== "matinee") readers.add(w.s.teacher.id);
    readers.add(w.s.owner.id);
    const t0 = Date.parse(created);
    for (const uid of readers) {
      if (!aud.includes(uid) && uid !== author.id) continue;
      const readAt = uid === author.id ? t0 : t0 + Math.min(now - t0 - 60_000, rng.int(5, 60 * 48) * 60_000);
      reads.push({ announcement_id: id, user_id: uid, kindergarten_id: kg, read_at: new Date(Math.max(t0, readAt)).toISOString() });
    }
    if (a.photo) {
      const p = `${kg}/${id}/${uuid()}.png`;
      const png = gradientPng(800, 450, [255, 244, 230], [232, 163, 61]);
      await upload(db, "announcements", p, png, "image/png");
      files.push({ id: uuid(), announcement_id: id, kindergarten_id: kg, kind: "photo", path: p, name: "Афиша праздника.png", mime: "image/png", size: png.length, created_at: created });
    }
    if (a.pdf) {
      const p = `${kg}/${id}/${uuid()}.pdf`;
      const pdf = tinyPdf("Happy Steps - photo session price list");
      await upload(db, "announcements", p, pdf, "application/pdf");
      files.push({ id: uuid(), announcement_id: id, kindergarten_id: kg, kind: "pdf", path: p, name: a.pdf, mime: "application/pdf", size: pdf.length, created_at: created });
    }
    out.push({ id, title: a.title, created, important: !!a.important, aud, readers });
  }
  await insertMany(db, "announcements", anns);
  await insertMany(db, "announcement_groups", links);
  await insertMany(db, "announcement_reads", reads, 1000);
  await insertMany(db, "announcement_files", files);
  return out;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function seedEvents(db: SupabaseClient, w: World) {
  const kg = w.kgId;
  const rows: Row[] = [];
  const links: Row[] = [];
  const nextHoliday = [...w.holidays.entries()]
    .filter(([d, h]) => d > w.today && h.kind === "holiday" && weekday(d) <= 5)
    .sort(([a], [b]) => a.localeCompare(b))[0];
  for (const e of EVENTS) {
    let date = addDays(w.today, e.offset);
    let title = e.title;
    if (e.kind === "holiday") {
      if (!nextHoliday) continue;
      date = nextHoliday[0];
      const name = nextHoliday[1].name;
      const m = /^Выходной \(перенос: (.+)\)$/.exec(name);
      title = `${m ? m[1] : name} — сад не работает`;
    } else if (e.title === "День знаний") date = w.schoolYear;
    else if (e.title === "Проводы в школу") date = w.graduation;
    else if (e.title === "Санитарный день") date = w.sanitaryDay;
    const author = e.author === "teacher" ? w.s.teacher : w.s[e.author];
    const created = date <= w.today ? at(addDays(date, -12), "11:00") : at(addDays(w.today, -w.rng.int(2, 12)), "15:30");
    const id = uuid();
    rows.push({
      id, kindergarten_id: kg, author_id: author.id, audience: e.audience, kind: e.kind, title, date,
      start_time: e.start ?? null, end_time: e.end ?? null, place: e.place ?? null, description: e.description ?? null,
      // past events were reminded the day before (the cron would not send them again)
      reminded_for: date <= w.today ? date : null, reminded_at: date <= w.today ? at(addDays(date, -1), "08:00") : null,
      created_at: created, updated_at: created,
    });
    for (const g of e.groups ?? []) links.push({ event_id: id, group_id: w.groups.get(g)!.id, kindergarten_id: kg });
  }
  await insertMany(db, "events", rows);
  await insertMany(db, "event_groups", links);
}

export async function seedChats(db: SupabaseClient, w: World): Promise<SocialResult["messageIds"]> {
  const rng = w.rng;
  const kg = w.kgId;
  const chats = check(await db.from("chats").select("id, kind, group_id").eq("kindergarten_id", kg), "chats") as { id: string; kind: string; group_id: string | null }[];
  const groupChat = new Map(chats.filter((c) => c.kind === "group").map((c) => [c.group_id!, c.id]));
  const staffChat = chats.find((c) => c.kind === "staff")!.id;
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const messages: Row[] = [];
  const files: { p: string; row: Row }[] = [];
  const chatRows: Row[] = [];
  const reads: Row[] = [];
  const audit: Row[] = [];
  const sent: SocialResult["messageIds"] = [];
  const msg = (chat: string, author: { id: string; name: string }, body: string, minutesAgo: number, extra: Row = {}, to: string[] = []) => {
    const id = uuid();
    messages.push({ id, kindergarten_id: kg, chat_id: chat, author_id: author.id, body, reply_to: null, created_at: ago(minutesAgo), deleted_at: null, deleted_by: null, ...extra });
    sent.push({ id, chat, author, body, at: ago(minutesAgo), to });
    return id;
  };
  const read = (chat: string, user: string, minutesAgo: number) => reads.push({ chat_id: chat, user_id: user, kindergarten_id: kg, last_read_at: ago(minutesAgo) });

  // Group chats.
  let gi = 0;
  for (const g of w.groups.values()) {
    const chat = groupChat.get(g.id)!;
    const shift = gi * 13;
    const kids = activeIn(w, g.key).sort((a, b) => (a.family === w.demoParent ? -1 : b.family === w.demoParent ? 1 : 0));
    const parentList = [...new Set(kids.map((k) => k.family.parents[0]))].filter((p) => !p.staffKey);
    const teacher = g.teachers[0];
    const who = (key: string) => (key === "teacher" ? teacher : key === "head" ? w.s.head : parentList[(Number(key.slice(6)) - 1) % parentList.length]);
    let questionId: string | null = null;
    const writers = new Set<string>();
    GROUP_CHAT.forEach(([key, text, minutes], i) => {
      if (g.key !== "zhuldyz" && i > 0 && !rng.chance(0.75)) return;
      const author = who(key);
      writers.add(author.id);
      const extra: Row = {};
      if (i === 3 && questionId) extra.reply_to = questionId;
      const id = msg(chat, author, text, minutes + shift, extra);
      if (i === 2) questionId = id;
      if (i === 8) {
        const photoMsg = msg(chat, teacher, "Прогулка во дворе 🍁", minutes + shift - 2);
        const p = `${kg}/${chat}/${uuid()}.png`;
        files.push({ p, row: { id: uuid(), kindergarten_id: kg, chat_id: chat, message_id: photoMsg, kind: "photo", path: p, name: "Прогулка.png", mime: "image/png", created_at: ago(minutes + shift - 2) } });
      }
    });
    if (g.key === "raduga") {
      // Moderation: a removed parent message (SPEC §5.7).
      const id = msg(chat, parentList[2 % parentList.length], "", 60 * 26 + shift, { deleted_at: ago(60 * 25), deleted_by: w.s.head.id });
      audit.push({ kindergarten_id: kg, actor_id: w.s.head.id, action: "chat.message_delete", entity: "message", entity_id: id, details: { chat_id: chat, group_id: g.id, text: "Реклама: продаю детские вещи, пишите в личку" }, created_at: ago(60 * 25) });
    }
    for (const t of g.teachers) read(chat, t.id, 0);
    read(chat, w.s.head.id, 0);
    read(chat, w.s.owner.id, gi === 0 ? 60 * 24 : 30);
    for (const p of parentList) {
      if (p.id === w.demoParent.parents[0].id) read(chat, p.id, 170 + shift);
      else if (writers.has(p.id) || rng.chance(0.6)) read(chat, p.id, writers.has(p.id) ? 0 : rng.int(0, 60 * 24 * 3));
    }
    gi++;
  }

  // Staff chat.
  const staffWho: Record<string, Staff> = { head: w.s.head, cook: w.s.cook, teacher: w.s.teacher, accountant: w.s.accountant, owner: w.s.owner, club: w.s.clubTeacher };
  for (const [key, text, minutes] of STAFF_CHAT) msg(staffChat, staffWho[key], text, minutes);
  for (const st of w.staff.filter((x) => x.roles.length && !x.archivedOn)) {
    if (st.key === "owner") read(staffChat, st.id, 60 * 24 * 2);
    else read(staffChat, st.id, st.login ? 0 : rng.int(0, 60 * 24));
  }

  // Direct chats (always with a staff member on one side; never parent ↔ parent).
  const direct = (a: { id: string }, b: { id: string }, created: number) => {
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const id = uuid();
    chatRows.push({ id, kindergarten_id: kg, kind: "direct", user_a: x, user_b: y, created_by: a.id, created_at: ago(created) });
    return id;
  };
  const parent = { id: w.demoParent.parents[0].id, name: w.demoParent.parents[0].name };
  const T = w.s.teacher;
  const d1 = direct(parent, T, 60 * 24 * 3);
  msg(d1, parent, "Асель Ерлановна, здравствуйте! Алдияр говорит, что на прогулке мёрзнут руки — можно ему перчатки?", 60 * 24 * 2 + 30, {}, [T.id]);
  msg(d1, T, "Здравствуйте! Конечно, положите в шкафчик — проследим 👍", 60 * 24 * 2 + 10, {}, [parent.id]);
  msg(d1, parent, "Спасибо большое!", 60 * 24 * 2, {}, [T.id]);
  msg(d1, T, "Ерлан Нурланович, Алдияр сегодня рассказал стихотворение про осень лучше всех в группе 🍂", 35, {}, [parent.id]);
  read(d1, T.id, 30);
  read(d1, parent.id, 60 * 24);

  const debtor = w.children.find((c) => !c.leave && c.family.payer === "debtor");
  if (debtor) {
    const p = debtor.family.parents[0];
    const d2 = direct(w.s.accountant, p, 60 * 24 * 4);
    msg(d2, w.s.accountant, "Здравствуйте! Напоминаю: за прошлый месяц осталась оплата. Реквизиты и Kaspi-номер — в разделе «Оплата».", 60 * 24 * 3, {}, [p.id]);
    msg(d2, p, "Добрый день! Оплачу до пятницы, извините за задержку.", 60 * 5, {}, [w.s.accountant.id]);
    read(d2, p.id, 60 * 5);
    read(d2, w.s.accountant.id, 60 * 24 * 3);
  }
  const d3 = direct(w.s.head, T, 60 * 24 * 10);
  msg(d3, w.s.head, "Асель Ерлановна, в четверг замените, пожалуйста, вторую смену в «Күншуақ» до 19:00.", 60 * 24 + 200, {}, [T.id]);
  msg(d3, T, "Хорошо, Елена Викторовна.", 60 * 24 + 180, {}, [w.s.head.id]);
  read(d3, w.s.head.id, 60 * 24);
  read(d3, T.id, 60 * 24);
  const d4 = direct(w.s.clubTeacher, parent, 60 * 24 * 2);
  msg(d4, w.s.clubTeacher, "Здравствуйте! Алдияр в очереди в шахматы. Как только освободится место — сразу сообщу.", 60 * 24 + 60, {}, [parent.id]);
  msg(d4, parent, "Спасибо, будем ждать!", 60 * 24 + 20, {}, [w.s.clubTeacher.id]);
  read(d4, w.s.clubTeacher.id, 60 * 24);
  read(d4, parent.id, 60 * 24);
  const bal = w.groups.get("balapan")!.teachers[0];
  const d5 = direct(w.s.teacherParent, bal, 60 * 24 * 20);
  msg(d5, w.s.teacherParent, "Как Лев сегодня поел?", 60 * 4, {}, [bal.id]);
  msg(d5, bal, "Всё съел, даже суп 😊 Спал хорошо.", 60 * 3 + 40, {}, [w.s.teacherParent.id]);
  read(d5, w.s.teacherParent.id, 60 * 3);
  read(d5, bal.id, 60 * 3);
  const d6 = direct(w.s.owner, w.s.head, 60 * 24 * 30);
  msg(d6, w.s.owner, "Елена Викторовна, подготовьте, пожалуйста, к понедельнику список сотрудников на медосмотр.", 60 * 24 * 2 + 300, {}, [w.s.head.id]);
  msg(d6, w.s.head, "Готово, список в чате сотрудников.", 60 * 24 * 2 + 120, {}, [w.s.owner.id]);
  read(d6, w.s.owner.id, 60 * 24 * 2);
  read(d6, w.s.head.id, 60 * 24 * 2);

  await insertMany(db, "chats", chatRows);
  await insertMany(db, "messages", messages);
  for (const f of files) {
    const png = gradientPng(640, 480, [232, 245, 233], [79, 163, 224]);
    await upload(db, "chat-files", f.p, png, "image/png");
    f.row.size = png.length;
  }
  await insertMany(db, "message_files", files.map((f) => f.row));
  // One marker per (chat, user): keep the latest.
  const latest = new Map<string, Row>();
  for (const r of reads) {
    const k = `${r.chat_id as string}|${r.user_id as string}`;
    const prev = latest.get(k);
    if (!prev || (r.last_read_at as string) > (prev.last_read_at as string)) latest.set(k, r);
  }
  await insertMany(db, "chat_reads", [...latest.values()]);
  await insertMany(db, "audit_log", audit);
  return sent.filter((m) => m.to.length);
}

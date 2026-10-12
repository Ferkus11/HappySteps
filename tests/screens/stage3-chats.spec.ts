import { test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";
import { service } from "../../scripts/seed/lib";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage3";
const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });

// Conversation used for the screenshots (removed and re-created on every run).
const TEXTS = [
  "Доброе утро! Сегодня после завтрака идём на прогулку в парк 🍂",
  "Не забудьте, пожалуйста, сменные носки и шапку.",
  "Хорошо, положили в шкафчик. Алихан сегодня немного кашляет — можно ему гулять поменьше?",
  "Конечно, присмотрим. Если будет хуже — сразу позвоню.",
  "Фото с утренней зарядки 💪",
  "Спасибо большое! Какие молодцы",
  "Добрый день! Справку от педиатра принесём в понедельник, отправляю скан.",
];

let sun = "";
let kgA = "";
let direct = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0].id as string;

async function photo(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 900, 600);
    grad.addColorStop(0, "#EAF5FD");
    grad.addColorStop(1, "#FDF1E3");
    g.fillStyle = grad;
    g.fillRect(0, 0, 900, 600);
    g.fillStyle = "#7BC47F";
    g.fillRect(0, 430, 900, 170);
    const colors = ["#E8A33D", "#C02A62", "#4FA3E0", "#2E9E7A", "#7C6CD6"];
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 165;
      g.fillStyle = colors[i];
      g.beginPath();
      g.arc(x, 300, 42, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - 30, 340, 60, 90);
    }
    g.fillStyle = "#FFD54F";
    g.beginPath();
    g.arc(780, 110, 60, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/jpeg", 0.85);
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test.beforeAll(async () => {
  kgA = await id("select id from kindergartens where slug = 'e2e-a'");
  sun = await id("select c.id from chats c join groups g on g.id = c.group_id where g.kindergarten_id = $1 and g.name = 'Солнышко'", [kgA]);
  await db.query("delete from messages where body like 'E2E %' or body = any($1) or (chat_id = $2 and body = '')", [TEXTS, sun]);
  await db.query("update chats set parents_can_write = true where kindergarten_id = $1", [kgA]);
});
test.afterAll(async () => {
  await db.query("update chats set parents_can_write = true where kindergarten_id = $1", [kgA]);
  await db.end();
});

test("chats · build a conversation", async ({ page }) => {
  const users = Object.fromEntries(
    (await db.query("select phone, id from profiles where phone = any($1)", [[PHONES.teacher, PHONES.parent, PHONES.head]])).rows.map((r) => [r.phone, r.id]),
  );
  const teacher = users[PHONES.teacher];
  const parent = users[PHONES.parent];
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const ins = async (chat: string, author: string, body: string, at: string, replyTo: string | null = null) =>
    id("insert into messages (kindergarten_id, chat_id, author_id, body, created_at, reply_to) values ($1, $2, $3, $4, $5, $6) returning id", [kgA, chat, author, body, at, replyTo]);
  await ins(sun, teacher, TEXTS[0], ago(60 * 3));
  await ins(sun, teacher, TEXTS[1], ago(60 * 3 - 1));
  const q = await ins(sun, parent, TEXTS[2], ago(60 * 2));
  await ins(sun, teacher, TEXTS[3], ago(60 * 2 - 5), q);
  const withPhoto = await ins(sun, teacher, TEXTS[4], ago(50));
  await page.goto("/login");
  const buf = await photo(page);
  const path = `${kgA}/${sun}/screens-zaryadka.jpg`;
  await service().storage.from("chat-files").upload(path, buf, { contentType: "image/jpeg", upsert: true });
  await db.query("delete from message_files where path = $1", [path]);
  await db.query("insert into message_files (kindergarten_id, chat_id, message_id, kind, path, name, mime, size) values ($1, $2, $3, 'photo', $4, 'zaryadka.jpg', 'image/jpeg', $5)", [
    kgA, sun, withPhoto, path, buf.length,
  ]);
  await ins(sun, parent, TEXTS[5], ago(40));
  await db.query("insert into chat_reads (chat_id, user_id, kindergarten_id, last_read_at) values ($1, $2, $3, now()) on conflict (chat_id, user_id) do update set last_read_at = now()", [sun, teacher, kgA]);

  // direct chat parent ↔ teacher, read by the teacher
  const [a, b] = [teacher, parent].sort();
  direct = (
    await db.query(
      `insert into chats (kindergarten_id, kind, user_a, user_b) values ($1, 'direct', $2, $3)
       on conflict (kindergarten_id, user_a, user_b) where kind = 'direct' do update set kind = excluded.kind returning id`,
      [kgA, a, b],
    )
  ).rows[0].id;
  await db.query("delete from messages where chat_id = $1", [direct]);
  await ins(direct, parent, TEXTS[6], ago(30));
  await db.query("insert into chat_reads (chat_id, user_id, kindergarten_id, last_read_at) values ($1, $2, $3, now()) on conflict (chat_id, user_id) do update set last_read_at = now()", [direct, teacher, kgA]);
  await db.query("delete from chat_reads where chat_id = $1 and user_id = $2", [sun, parent]);
});

test("chats · parent", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.goto("/chats");
  await page.getByTestId("chat-list").waitFor();
  await snap(page, S, "chats-parent-list");
  await page.goto(`/chats/${sun}`);
  await page.getByTestId("message-photo").locator("img").first().waitFor();
  await page.waitForTimeout(400);
  await snap(page, S, "chats-parent-group");
  await page.goto(`/chats/${direct}`);
  await page.getByTestId("read-tick").first().waitFor();
  await snap(page, S, "chats-parent-direct");
  await page.goto("/chats");
  await page.getByTestId("new-chat").click();
  await page.getByTestId("contact").first().waitFor();
  await snap(page, S, "chats-parent-new");
});

test("chats · teacher, head, club teacher", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.getByTestId("widget-group-chat").waitFor();
  await snap(page, S, "chats-teacher-dashboard");
  await page.goto(`/chats/${sun}`);
  await page.getByTestId("message-photo").locator("img").first().waitFor();
  const m = page.getByTestId("message").filter({ hasText: TEXTS[5] });
  await m.hover();
  await m.getByTestId("message-menu").click();
  await page.getByTestId("message-reply").click();
  await page.getByTestId("composer-input").fill("Спасибо!");
  await snap(page, S, "chats-teacher-reply");

  await login(page, PHONES.head);
  await page.goto(`/chats/${sun}`);
  await page.getByTestId("message-photo").locator("img").first().waitFor();
  const bad = page.getByTestId("message").filter({ hasText: TEXTS[5] });
  await bad.hover();
  await bad.getByTestId("message-menu").click();
  await snap(page, S, "chats-head-moderation-menu");
  await page.getByTestId("message-delete").click();
  await page.getByTestId("confirm-delete-message").click();
  await page.getByTestId("message-deleted").first().waitFor();
  await page.getByTestId("chat-settings").click();
  await snap(page, S, "chats-head-moderation");
  await page.getByTestId("toggle-staff-only").click();
  await page.getByTestId("chat-heading").waitFor();

  await login(page, PHONES.parent);
  await page.goto(`/chats/${sun}`);
  await page.getByTestId("composer-locked").waitFor();
  await snap(page, S, "chats-parent-readonly");
  await db.query("update chats set parents_can_write = true where id = $1", [sun]);

  await login(page, PHONES.clubTeacher);
  await page.getByTestId("widget-chats").waitFor();
  await snap(page, S, "chats-clubteacher-dashboard");
});

test("chats · kazakh", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: new URL(page.url()).origin }]);
  await page.goto("/chats");
  await page.getByTestId("chat-list").waitFor();
  await snap(page, S, "chats-parent-list-kk");
  await page.goto(`/chats/${sun}`);
  await page.getByTestId("message-photo").locator("img").first().waitFor();
  await snap(page, S, "chats-parent-group-kk");
  await page.context().addCookies([{ name: "hs_locale", value: "ru", url: new URL(page.url()).origin }]);
});

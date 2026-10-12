import { expect, test, type Browser, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { PHONES, login } from "./helpers";
import { ensureMembership, ensureUser, service } from "../../scripts/seed/lib";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const RUN = Date.now().toString(36);
const say = (s: string) => `E2E ${s} ${RUN}`;
// A second parent of the group Солнышко (guardian of Айлин) — only for this spec, removed afterwards.
const PARENT2 = { phone: "+77010000077", name: "Касымова Жанар Нурлановна" };
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let sun = "";
let kgA = "";
let parent2 = "";

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

test.beforeAll(async () => {
  kgA = (await one("select id from kindergartens where slug = 'e2e-a'")).id;
  sun = (await one("select c.id from chats c join groups g on g.id = c.group_id where g.kindergarten_id = $1 and g.name = 'Солнышко'", [kgA])).id;
  await db.query("delete from messages where body like 'E2E %'");
  await db.query("update chats set parents_can_write = true where kindergarten_id = $1", [kgA]);
  const s = service();
  parent2 = await ensureUser(s, PARENT2.phone, PARENT2.name, "Test1234!");
  await ensureMembership(s, parent2, kgA, "parent");
  await db.query("update memberships set status = 'active' where user_id = $1 and kindergarten_id = $2", [parent2, kgA]);
  const child = (await one("select id from children where kindergarten_id = $1 and full_name like 'Касымова Айлин%'", [kgA])).id;
  await db.query("insert into child_guardians (child_id, user_id, kindergarten_id) values ($1, $2, $3) on conflict do nothing", [child, parent2, kgA]);
});

test.afterAll(async () => {
  await db.query("update chats set parents_can_write = true where kindergarten_id = $1", [kgA]);
  await db.query("delete from child_guardians where user_id = $1", [parent2]);
  await db.query("update memberships set status = 'archived' where user_id = $1", [parent2]);
  await db.query("delete from notifications where url like '/chats/%'");
  await db.end();
});

async function as(browser: Browser, phone: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, phone);
  return page;
}

async function openSun(page: Page) {
  await page.goto(`/chats/${sun}`);
  await expect(page.getByTestId("chat-heading")).toHaveText("Солнышко");
}

async function send(page: Page, text: string) {
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message").filter({ hasText: text }).last()).toBeVisible();
}

const bubble = (page: Page, text: string) => page.getByTestId("message").filter({ hasText: text });

test("scenario 8: a teacher's message in the group chat reaches the parent in realtime", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const teacher = await as(browser, PHONES.teacher);
  await openSun(parent);
  await openSun(teacher);
  const text = say("Завтра прогулка в парке, оденьте детей потеплее");
  await send(teacher, text);
  // no reload on the parent's side
  await expect(bubble(parent, text)).toBeVisible();
  await expect(bubble(parent, text).getByText("Нурланова Асель Ериковна")).toBeVisible();
  // the parent answers with a reply, the teacher gets it live
  await bubble(parent, text).hover();
  await bubble(parent, text).getByTestId("message-menu").click();
  await parent.getByTestId("message-reply").click();
  const answer = say("Спасибо, поняли");
  await send(parent, answer);
  await expect(bubble(teacher, answer)).toBeVisible();
  await expect(bubble(teacher, answer).getByTestId("reply-quote")).toContainText("Завтра прогулка");
  await parent.context().close();
  await teacher.context().close();
});

test("scenario 8: a parent cannot write privately to another parent (UI and forged RPC)", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  await parent.goto("/chats");
  await parent.getByTestId("new-chat").click();
  const list = parent.getByTestId("contact-list");
  await expect(list.getByTestId("contact")).toHaveCount(3);
  await expect(list).toContainText("Нурланова Асель Ериковна");
  await expect(list).toContainText("Ким Елена Викторовна");
  await expect(list).toContainText("Сапарова Айгерим Маратовна");
  await expect(list).not.toContainText(PARENT2.name);
  await expect(list).not.toContainText("Смирнова Ольга Ивановна");
  await parent.context().close();

  // Forged call straight to the API with the parent's own session.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
  await c.auth.signInWithPassword({ email: `${PHONES.parent.replace(/\D/g, "")}@${domain}`, password: "Test1234!" });
  const r = await c.rpc("start_direct_chat", { p_kg: kgA, p_other: parent2 });
  expect(r.error).not.toBeNull();
  const [a, b] = [(await c.auth.getUser()).data.user!.id, parent2].sort();
  const ins = await c.from("chats").insert({ kindergarten_id: kgA, kind: "direct", user_a: a, user_b: b });
  expect(ins.error).not.toBeNull();
  // but the other parent is a member of the group chat and reads it
  const p2 = await as(browser, PARENT2.phone);
  await openSun(p2);
  await expect(p2.getByTestId("composer")).toBeVisible();
  await p2.context().close();
});

test("unread badge increments live and clears when the chat is opened", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const teacher = await as(browser, PHONES.teacher);
  const since = new Date();
  await openSun(parent); // read everything
  await expect
    .poll(async () => (await one("select max(r.last_read_at) as t from chat_reads r join profiles p on p.id = r.user_id where r.chat_id = $1 and p.phone = $2", [sun, PHONES.parent])).t?.getTime() ?? 0)
    .toBeGreaterThan(since.getTime() - 1000);
  await parent.goto("/chats");
  const item = parent.getByTestId("chat-list").locator(`[data-chat-id="${sun}"]`);
  await expect(item.getByTestId("chat-unread")).toHaveCount(0);
  await openSun(teacher);
  await send(teacher, say("Напоминание: завтра утренник"));
  await expect(item.getByTestId("chat-unread")).toHaveText("1");
  await send(teacher, say("Начало в 10:00"));
  await expect(item.getByTestId("chat-unread")).toHaveText("2");
  await expect(item).toContainText("Начало в 10:00");
  await item.click();
  await expect(parent.getByTestId("chat-heading")).toHaveText("Солнышко");
  await expect(item.getByTestId("chat-unread")).toHaveCount(0);
  await parent.reload();
  // header badge (desktop) is gone after the page is re-rendered
  await expect(parent.locator('header a[href="/chats"] span')).toHaveCount(0);
  await parent.context().close();
  await teacher.context().close();
});

test("head removes a parent's message — everyone sees «Сообщение удалено администрацией»", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const head = await as(browser, PHONES.head);
  await openSun(parent);
  const text = say("Неуместное сообщение");
  await send(parent, text);
  await openSun(head);
  await bubble(head, text).hover();
  await bubble(head, text).getByTestId("message-menu").click();
  await head.getByTestId("message-delete").click();
  await head.getByTestId("confirm-delete-message").click();
  await expect(bubble(head, text)).toHaveCount(0);
  await expect(head.getByTestId("message-deleted").filter({ hasText: "Сообщение удалено администрацией" }).last()).toBeVisible();
  // realtime on the parent's side
  await expect(bubble(parent, text)).toHaveCount(0);
  await expect(parent.getByTestId("message-deleted").filter({ hasText: "Сообщение удалено администрацией" }).last()).toBeVisible();
  const logged = await one("select count(*)::int as n from audit_log where action = 'chat.message_delete' and details->>'text' = $1", [text]);
  expect(logged.n).toBe(1);
  await parent.context().close();
  await head.context().close();
});

test("head switches the group chat to «только сотрудники пишут» — parent's composer locks, server rejects", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const head = await as(browser, PHONES.head);
  await openSun(parent);
  await openSun(head);
  await head.getByTestId("chat-settings").click();
  await head.getByTestId("toggle-staff-only").click();
  await expect(head.getByText("Теперь в чате пишут только сотрудники")).toBeVisible();
  await expect(parent.getByTestId("composer-locked")).toBeVisible();
  await expect(parent.getByTestId("composer")).toHaveCount(0);
  await parent.reload();
  await expect(parent.getByTestId("composer-locked")).toContainText("пишут только сотрудники");
  // the API refuses a parent's message
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: `${PHONES.parent.replace(/\D/g, "")}@${process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local"}`, password: "Test1234!" });
  const uid = (await c.auth.getUser()).data.user!.id;
  const r = await c.from("messages").insert({ kindergarten_id: kgA, chat_id: sun, author_id: uid, body: say("в обход") });
  expect(r.error).not.toBeNull();
  // staff still write
  await send(head, say("Объявление от заведующей"));
  await expect(bubble(parent, say("Объявление от заведующей"))).toBeVisible();
  // unlock again
  await head.getByTestId("chat-settings").click();
  await head.getByTestId("toggle-staff-only").click();
  await expect(parent.getByTestId("composer")).toBeVisible();
  await parent.context().close();
  await head.context().close();
});

test("attachments: a parent sends a PDF and a photo, the teacher opens them", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const teacher = await as(browser, PHONES.teacher);
  await openSun(parent);
  await openSun(teacher);
  await parent.getByTestId("composer-file-input").setInputFiles({ name: "справка.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(parent.getByTestId("composer-file")).toContainText("справка.pdf");
  await parent.getByTestId("composer-input").fill(say("Справка от врача"));
  await parent.getByTestId("composer-send").click();
  const pdf = teacher.getByTestId("message").filter({ hasText: say("Справка от врача") }).getByTestId("message-file");
  await expect(pdf).toContainText("справка.pdf");
  const href = await pdf.getAttribute("href");
  const res = await teacher.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  await parent.getByTestId("composer-file-input").setInputFiles({ name: "рисунок.png", mimeType: "image/png", buffer: PNG });
  await parent.getByTestId("composer-input").fill(say("Рисунок"));
  await parent.getByTestId("composer-send").click();
  const img = teacher.getByTestId("message-photo").last().locator("img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // a member of another garden cannot open the file
  const fileId = href!.split("/").pop();
  const b = await as(browser, PHONES.parentB);
  const denied = await b.request.get(`/chats/file/${fileId}`, { maxRedirects: 0 });
  expect(denied.status()).toBe(404);
  await b.context().close();
  await parent.context().close();
  await teacher.context().close();
});

test("direct chat parent ↔ teacher with «прочитано»", async ({ browser }) => {
  const parent = await as(browser, PHONES.parent);
  const teacher = await as(browser, PHONES.teacher);
  await parent.goto("/chats");
  await parent.getByTestId("new-chat").click();
  await parent.getByTestId("new-chat-search").fill("Нурланова");
  await parent.getByTestId("contact").click();
  await expect(parent.getByTestId("chat-heading")).toHaveText("Нурланова Асель Ериковна");
  const text = say("Добрый день! Алихан сегодня без дневного сна?");
  await send(parent, text);
  const tick = bubble(parent, text).getByTestId("read-tick");
  await expect(tick).toHaveAttribute("data-read", "false");
  const chatUrl = parent.url();
  await teacher.goto(new URL(chatUrl).pathname);
  await expect(bubble(teacher, text)).toBeVisible();
  await expect(tick).toHaveAttribute("data-read", "true");
  await parent.context().close();
  await teacher.context().close();
});

test("late joiner: a parent sees the group chat from the day the child joined it; staff see all", async ({ browser }) => {
  const old = say("Сообщение до прихода Айлин");
  const teacherId = (await one("select id from profiles where phone = $1", [PHONES.teacher])).id;
  await db.query("insert into messages (kindergarten_id, chat_id, author_id, body, created_at) values ($1, $2, $3, $4, now() - interval '5 days')", [kgA, sun, teacherId, old]);
  const child = (await one("select id from children where kindergarten_id = $1 and full_name like 'Касымова Айлин%'", [kgA])).id;
  const hist = await one("select id, from_date::text as from_date from child_group_history where child_id = $1 and to_date is null", [child]);
  await db.query("update child_group_history set from_date = current_date - 1 where id = $1", [hist.id]);
  try {
    const p2 = await as(browser, PARENT2.phone);
    await openSun(p2);
    await expect(bubble(p2, "Все на месте, завтракаем")).toBeVisible();
    await expect(bubble(p2, old)).toHaveCount(0);
    const parent = await as(browser, PHONES.parent);
    await openSun(parent);
    await expect(bubble(parent, old)).toBeVisible();
    await p2.context().close();
    await parent.context().close();
  } finally {
    await db.query("update child_group_history set from_date = $2::date where id = $1", [hist.id, hist.from_date]);
  }
});

test("quiet hours: the parent is warned, staff get the bell now and the push in the morning", async ({ browser }) => {
  const prev = await one("select quiet_hours_start::text as s, quiet_hours_end::text as e from kindergarten_settings where kindergarten_id = $1", [kgA]);
  await db.query("update kindergarten_settings set quiet_hours_start = '00:00', quiet_hours_end = '23:59' where kindergarten_id = $1", [kgA]);
  await db.query("delete from notifications where url = $1", [`/chats/${sun}`]);
  await db.query("update chat_reads set last_read_at = now() - interval '1 hour' where chat_id = $1", [sun]);
  try {
    const parent = await as(browser, PHONES.parent);
    await openSun(parent);
    await expect(parent.getByTestId("quiet-hint")).toContainText("Сотрудники получат сообщение утром");
    await send(parent, say("Вопрос поздним вечером"));
    const rows = async () =>
      (await db.query("select p.phone, n.deliver_after from notifications n join profiles p on p.id = n.user_id where n.url = $1", [`/chats/${sun}`])).rows as {
        phone: string;
        deliver_after: Date | null;
      }[];
    await expect.poll(async () => (await rows()).length).toBeGreaterThanOrEqual(3);
    const byPhone = Object.fromEntries((await rows()).map((r) => [r.phone, r.deliver_after]));
    for (const staff of [PHONES.teacher, PHONES.head, PHONES.owner]) {
      expect(byPhone[staff], staff).toBeInstanceOf(Date);
      expect(byPhone[staff]!.getTime(), staff).toBeGreaterThan(Date.now());
    }
    expect(byPhone[PARENT2.phone]).toBeNull();
    await parent.context().close();
  } finally {
    await db.query("update kindergarten_settings set quiet_hours_start = $2::time, quiet_hours_end = $3::time where kindergarten_id = $1", [kgA, prev.s, prev.e]);
    await db.query("delete from notifications where url = $1", [`/chats/${sun}`]);
  }
});

test("a message can be edited only within 15 minutes of sending; edited ones are marked «изменено»", async ({ browser }) => {
  const parentId = (await one("select id from profiles where phone = $1", [PHONES.parent])).id;
  const old = say("Отправлено давно");
  await db.query("insert into messages (kindergarten_id, chat_id, author_id, body, created_at) values ($1, $2, $3, $4, now() - interval '20 minutes')", [kgA, sun, parentId, old]);
  const parent = await as(browser, PHONES.parent);
  await openSun(parent);
  await bubble(parent, old).hover();
  await bubble(parent, old).getByTestId("message-menu").click();
  await expect(parent.getByTestId("message-reply")).toBeVisible();
  await expect(parent.getByTestId("message-edit")).toHaveCount(0);
  await parent.keyboard.press("Escape");
  const fresh = say("Опечатка в сообщении");
  await send(parent, fresh);
  await bubble(parent, fresh).hover();
  await bubble(parent, fresh).getByTestId("message-menu").click();
  await parent.getByTestId("message-edit").click();
  const fixed = say("Исправленное сообщение");
  await parent.getByTestId("composer-input").fill(fixed);
  await parent.getByTestId("composer-send").click();
  await expect(bubble(parent, fixed)).toContainText("изменено");
  // the server refuses to change the old one
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: `${PHONES.parent.replace(/\D/g, "")}@${process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local"}`, password: "Test1234!" });
  const r = await c.from("messages").update({ body: say("Поздняя правка") }).eq("body", old).select("id");
  expect(r.error?.message ?? "").toContain("hs:editExpired");
  await parent.context().close();
});

test("garden B sees nothing of garden A", async ({ page }) => {
  await login(page, PHONES.parentB);
  await page.goto("/chats");
  const titles = await page.getByTestId("chat-title").allInnerTexts();
  expect(titles).toEqual(["Ромашка"]);
  // The chat of garden A is "not found" (the page streams behind a skeleton, so check the content).
  await page.goto(`/chats/${sun}`);
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByTestId("chat-heading")).toHaveCount(0);
  await expect(page.getByTestId("message")).toHaveCount(0);
  // and the API returns nothing of A
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: `${PHONES.parentB.replace(/\D/g, "")}@${process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local"}`, password: "Test1234!" });
  expect((await c.from("messages").select("id").eq("kindergarten_id", kgA)).data).toEqual([]);
  expect((await c.from("chats").select("id").eq("kindergarten_id", kgA)).data).toEqual([]);
  expect((await c.rpc("chat_list", { p_kg: kgA })).data ?? []).toEqual([]);
});

test("smoke: every role has its chats", async ({ page }) => {
  const expectations: [string, string[]][] = [
    [PHONES.owner, ["Солнышко", "Звёздочки", "Сотрудники"]],
    [PHONES.accountant, ["Сотрудники"]],
    [PHONES.cook, ["Сотрудники"]],
    [PHONES.clubTeacher, ["Сотрудники"]],
  ];
  for (const [phone, titles] of expectations) {
    await login(page, phone);
    await page.goto("/chats");
    for (const title of titles) await expect(page.getByTestId("chat-title").filter({ hasText: new RegExp(`^${title}$`) })).toHaveCount(1);
    await expect(page.getByTestId("chat-title").filter({ hasText: /^Ромашка$/ })).toHaveCount(0);
  }
  // dashboard widgets
  await login(page, PHONES.teacher);
  await page.goto("/");
  await expect(page.getByTestId("widget-group-chat")).toContainText("Солнышко");
  await login(page, PHONES.clubTeacher);
  await page.goto("/");
  await expect(page.getByTestId("widget-chats")).toBeVisible();
});

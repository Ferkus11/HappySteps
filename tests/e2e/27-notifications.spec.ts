import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createDecipheriv, createECDH, createHmac, randomBytes, type ECDH } from "node:crypto";
import { PHONES, expectToast, login } from "./helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const RUN = Date.now().toString(36);
const say = (s: string) => `E2E ${s} ${RUN}`;
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const cron = (path: string) => ({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, path });

// ───────────── A stand-in push service on 127.0.0.1 (no internet needed) ─────────────
type Received = { path: string; headers: http.IncomingHttpHeaders; body: Buffer };
const received: Received[] = [];
let respondWith = 201;
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
    res.statusCode = respondWith;
    res.end();
  });
});
let endpoint = "";

// A browser's subscription keys: P-256 key pair + 16-byte auth secret (web-push encrypts to them).
const ecdh: ECDH = createECDH("prime256v1");
ecdh.generateKeys();
const authSecret = randomBytes(16);

/** RFC 8291 (aes128gcm) decryption — what the browser does with a push message. */
function decrypt(body: Buffer): Record<string, string> {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverKey = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const hmac = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();
  const prkKey = hmac(authSecret, ecdh.computeSecret(serverKey));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverKey, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--; // padding: …0x02 0x00…
  return JSON.parse(plain.subarray(0, end).toString("utf8"));
}

let kgA = "";
let sun = "";
let parentId = "";
let prevQuiet: { s: string; e: string } = { s: "21:00:00", e: "08:00:00" };

test.beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push/${RUN}`;
  kgA = (await one("select id from kindergartens where slug = 'e2e-a'")).id;
  sun = (await one("select c.id from chats c join groups g on g.id = c.group_id where g.kindergarten_id = $1 and g.name = 'Солнышко'", [kgA])).id;
  parentId = (await one("select id from profiles where phone = $1", [PHONES.parent])).id;
  prevQuiet = await one("select quiet_hours_start::text as s, quiet_hours_end::text as e from kindergarten_settings where kindergarten_id = $1", [kgA]);
  // Quiet hours off (start = end) unless a test turns them on; clean leftovers of earlier runs.
  await db.query("update kindergarten_settings set quiet_hours_start = '00:00', quiet_hours_end = '00:00' where kindergarten_id = $1", [kgA]);
  await db.query("delete from push_subscriptions where endpoint like 'http://127.0.0.1:%'");
  await db.query("delete from notification_preferences where user_id = $1", [parentId]);
  await db.query("update profiles set locale = 'ru' where id = $1", [parentId]);
  await db.query("update notifications set read_at = now() where user_id = $1 and read_at is null", [parentId]);
});

test.afterAll(async () => {
  await db.query("update kindergarten_settings set quiet_hours_start = $2::time, quiet_hours_end = $3::time where kindergarten_id = $1", [kgA, prevQuiet.s, prevQuiet.e]);
  await db.query("delete from push_subscriptions where endpoint like 'http://127.0.0.1:%'");
  await db.query("delete from notification_preferences where user_id = $1", [parentId]);
  await db.query("update profiles set locale = 'ru' where id = $1", [parentId]);
  await db.query("delete from notifications where url = $1 or params::text like '%E2E %'", [`/chats/${sun}`]);
  await db.query("delete from messages where body like 'E2E %'");
  await db.query("delete from announcements where title like $1", [`E2E %${RUN}`]);
  await db.end();
  server.close();
});

async function as(browser: Browser, phone: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, phone);
  return page;
}

/**
 * Stand-in browser push APIs (headless Chromium has no push service): permission prompt + pushManager. State lives
 * in localStorage, so it survives navigations like a real browser profile. `permission` = the starting permission.
 * Also inert service-worker events/controller (PwaRoot listens to them).
 */
async function stubPush(ctx: BrowserContext, ep: string, permission: NotificationPermission = "default") {
  await ctx.addInitScript(
    ({ ep, p256dh, auth, permission }) => {
      const store = {
        get: (k: string) => localStorage.getItem(`__push_${k}`),
        set: (k: string, v: string | null) => (v === null ? localStorage.removeItem(`__push_${k}`) : localStorage.setItem(`__push_${k}`, v)),
      };
      if (!store.get("permission")) store.set("permission", permission);
      const N = {
        get permission() {
          return store.get("permission") as NotificationPermission;
        },
        requestPermission: async () => {
          if (store.get("permission") === "default") store.set("permission", "granted");
          return store.get("permission") as NotificationPermission;
        },
      };
      Object.defineProperty(window, "Notification", { value: N, configurable: true });
      Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
      const sub = {
        endpoint: ep,
        toJSON: () => ({ endpoint: ep, keys: { p256dh, auth } }),
        unsubscribe: async () => (store.set("sub", null), true),
      };
      const reg = {
        active: {},
        addEventListener() {},
        pushManager: { getSubscription: async () => (store.get("sub") ? sub : null), subscribe: async () => (store.set("sub", "1"), sub) },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        value: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} },
        configurable: true,
      });
    },
    { ep, p256dh: ecdh.getPublicKey("base64url"), auth: authSecret.toString("base64url"), permission },
  );
}

const subscribedHere = (page: Page) => page.evaluate(() => localStorage.getItem("__push_sub") === "1");
const subOwner = async (ep: string) => (await one("select user_id from push_subscriptions where endpoint = $1", [ep]))?.user_id ?? null;

const bell = (page: Page) => page.getByTestId("unread-notifications");

async function insertFor(user: string, type: string, params: Record<string, unknown>, url: string | null, extra = "") {
  return (
    await one(
      `insert into notifications (kindergarten_id, user_id, type, params, url, pushed_at${extra ? ", created_at" : ""}) values ($1, $2, $3, $4, $5, now()${extra ? `, ${extra}` : ""}) returning id`,
      [kgA, user, type, JSON.stringify(params), url],
    )
  ).id as string;
}

test("bell count, the centre in the reader's language, live updates, mark read and «Прочитать все»", async ({ browser }) => {
  const rejected = await insertFor(parentId, "receipt.rejected", { month: "2026-10", reason: say("Нечитаемое фото") }, "/payments");
  await insertFor(parentId, "announcement.new", { title: say("Собрание") }, "/announcements");
  await db.query("update notifications set read_at = now() where id = $1", [await insertFor(parentId, "club.decision", { club: say("Танцы"), child: "Алихан", status: "active" }, "/clubs", "now() - interval '1 day'")]);

  const page = await as(browser, PHONES.parent);
  await expect(bell(page)).toHaveText("2");
  await page.goto("/notifications");
  const list = page.getByTestId("notification-list");
  await expect(list).toContainText("Сегодня");
  await expect(list).toContainText("Вчера");
  const item = page.getByTestId("notification").filter({ hasText: say("Нечитаемое фото") });
  await expect(item).toContainText("Чек отклонён");
  await expect(item).toContainText(`Октябрь 2026: ${say("Нечитаемое фото")}. Загрузите чек заново.`);
  await expect(item).toHaveAttribute("data-unread", "true");
  await expect(page.getByTestId("notification").filter({ hasText: say("Танцы") })).toContainText("Алихан: записан, ждём на занятиях");
  await expect(page.getByTestId("notification").filter({ hasText: say("Танцы") })).toHaveAttribute("data-unread", "false");

  // a new notification arrives live (Realtime): bell and list update without a reload
  await insertFor(parentId, "event.reminder", { title: say("Утренник"), date: "15.10.2026", time: "10:00", place: "Зал" }, "/events");
  await expect(bell(page)).toHaveText("3");
  await expect(page.getByTestId("notification").first()).toContainText(`Завтра: ${say("Утренник")}`);

  // click → read + go to its link
  await item.click();
  await page.waitForURL("**/payments");
  await expect(bell(page)).toHaveText("2");
  expect((await one("select read_at from notifications where id = $1", [rejected])).read_at).not.toBeNull();

  await page.goto("/notifications");
  await page.getByTestId("notifications-read-all").click();
  await expect(bell(page)).toHaveCount(0);
  await expect(page.locator('[data-testid="notification"][data-unread="true"]')).toHaveCount(0);
  expect(Number((await one("select count(*) from notifications where user_id = $1 and read_at is null and kindergarten_id = $2", [parentId, kgA])).count)).toBe(0);

  // Kazakh: the same rows, rendered in the reader's current language
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: page.url() }]);
  await page.reload();
  await expect(page.getByTestId("notification").filter({ hasText: say("Нечитаемое фото") })).toContainText("2026 ж. Қазан");
  await expect(page.getByTestId("notification").filter({ hasText: say("Танцы") })).toContainText("жазылды, сабақта күтеміз");
  await page.context().close();
});

test("profile: only the parent's types, a switch is saved, the push card subscribes this device", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty", viewport: { width: 1440, height: 900 } });
  await stubPush(ctx, `${endpoint}-ui`);
  const page = await ctx.newPage();
  await login(page, PHONES.parent);
  await page.goto("/profile");
  const section = page.getByTestId("notifications-section");
  await expect(section.getByTestId("pref-receipt-rejected")).toBeVisible();
  await expect(section.getByTestId("pref-club-decision")).toBeVisible();
  await expect(section.getByTestId("pref-waitlist-new")).toHaveCount(0);
  await expect(section.getByTestId("pref-receipt-new")).toHaveCount(0);

  await section.getByTestId("pref-announcement-new").click();
  await expect(section.getByTestId("pref-announcement-new")).toHaveAttribute("data-state", "unchecked");
  await expect.poll(async () => (await one("select enabled from notification_preferences where user_id = $1 and type = 'announcement.new'", [parentId]))?.enabled).toBe(false);
  await page.reload();
  await expect(section.getByTestId("pref-announcement-new")).toHaveAttribute("data-state", "unchecked");
  await section.getByTestId("pref-announcement-new").click();
  await expect.poll(async () => (await one("select enabled from notification_preferences where user_id = $1 and type = 'announcement.new'", [parentId]))?.enabled).toBe(true);

  const card = page.getByTestId("push-card");
  await expect(card).toHaveAttribute("data-state", "off");
  await card.getByTestId("push-enable").click();
  await expect(card).toHaveAttribute("data-state", "on");
  await expect.poll(async () => (await one("select user_id from push_subscriptions where endpoint = $1", [`${endpoint}-ui`]))?.user_id).toBe(parentId);
  await card.getByTestId("push-disable").click();
  await expect(card).toHaveAttribute("data-state", "off");
  await expect.poll(async () => (await db.query("select 1 from push_subscriptions where endpoint = $1", [`${endpoint}-ui`])).rowCount).toBe(0);
  await ctx.close();
});

test("shared device: logout removes this device's subscription; a second account in the same tab re-syncs it", async ({ browser }) => {
  const ep = `${endpoint}-shared`;
  const teacherId = (await one("select id from profiles where phone = $1", [PHONES.teacher])).id;
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty", viewport: { width: 1440, height: 900 } });
  await stubPush(ctx, ep);
  const page = await ctx.newPage();
  try {
    await login(page, PHONES.parent);
    await page.goto("/profile");
    await page.getByTestId("push-card").getByTestId("push-enable").click();
    await expect.poll(() => subOwner(ep)).toBe(parentId);

    // The session ends without a logout (expired) and the teacher signs in on the same device and tab:
    // the subscription follows the signed-in account (the sync marker is per user).
    await login(page, PHONES.teacher);
    await expect.poll(() => subOwner(ep), { timeout: 15_000 }).toBe(teacherId);

    // Logout: unsubscribed in the browser and deleted on the server — nothing reaches the lock screen any more.
    await page.getByTestId("account-menu").click();
    await page.getByTestId("logout").click();
    await page.waitForURL(/\/login$/);
    await expect.poll(() => subOwner(ep)).toBeNull();
    expect(await subscribedHere(page)).toBe(false);
  } finally {
    await ctx.close();
    await db.query("delete from push_subscriptions where endpoint = $1", [ep]);
  }
});

test("dashboard prompt: enable push in one tap; «Не сейчас» hides it on this device; not offered when blocked", async ({ browser }) => {
  const ep = `${endpoint}-prompt`;
  const open = async (permission: NotificationPermission) => {
    const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty", viewport: { width: 390, height: 844 } });
    await stubPush(ctx, ep, permission);
    const page = await ctx.newPage();
    await login(page, PHONES.parent);
    await expect(page.getByTestId("dashboard")).toBeVisible();
    return page;
  };
  try {
    const page = await open("default");
    const prompt = page.getByTestId("push-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Включите уведомления");
    await prompt.getByTestId("push-prompt-enable").click();
    await expectToast(page, "Push-уведомления включены");
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => subOwner(ep)).toBe(parentId);
    await page.reload();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("push-prompt")).toHaveCount(0); // already on
    await page.context().close();
    await db.query("delete from push_subscriptions where endpoint = $1", [ep]);

    const later = await open("default");
    await later.getByTestId("push-prompt-dismiss").click();
    await expect(later.getByTestId("push-prompt")).toHaveCount(0);
    await later.reload();
    await expect(later.getByTestId("dashboard")).toBeVisible();
    await later.waitForTimeout(1000);
    await expect(later.getByTestId("push-prompt")).toHaveCount(0);
    expect(await subOwner(ep)).toBeNull();
    await later.context().close();

    const blocked = await open("denied");
    await blocked.waitForTimeout(1000);
    await expect(blocked.getByTestId("push-prompt")).toHaveCount(0);
    await blocked.context().close();
  } finally {
    await db.query("delete from push_subscriptions where endpoint = $1", [ep]);
  }
});

test("a push opened after the session expired: login, then straight to the notification", async ({ browser }) => {
  const id = await insertFor(parentId, "receipt.accepted", { month: "2026-10", amount: say("1 ₸") }, "/payments");
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty" });
  const page = await ctx.newPage();
  await page.goto(`/notifications/${id}/open`);
  await page.waitForURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/notifications/${id}/open`);
  const input = page.getByLabel("Номер телефона");
  await input.click();
  await input.pressSequentially(PHONES.parent.replace(/^\+7/, ""));
  await page.getByLabel("Пароль").fill("Test1234!");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/payments$/);
  expect((await one("select read_at from notifications where id = $1", [id])).read_at).not.toBeNull();

  // a foreign `next` is ignored
  await ctx.clearCookies();
  await page.goto("/login?next=//evil.example/x");
  await input.click();
  await input.pressSequentially(PHONES.parent.replace(/^\+7/, ""));
  await page.getByLabel("Пароль").fill("Test1234!");
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  expect(page.url()).not.toContain("evil");
  await ctx.close();
});

test.describe("Web Push end-to-end", () => {
  let teacher: Page;

  test.beforeAll(async ({ browser }) => {
    await db.query("insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, 'e2e')", [
      parentId,
      endpoint,
      ecdh.getPublicKey("base64url"),
      authSecret.toString("base64url"),
    ]);
    teacher = await as(browser, PHONES.teacher);
    await teacher.goto(`/chats/${sun}`);
    await expect(teacher.getByTestId("conversation")).toHaveAttribute("data-live", "true");
  });
  test.afterAll(async () => {
    await teacher.context().close();
  });

  /** The parent has neither an unread bell row for the chat nor looked at it in the last minute. */
  async function freshChat() {
    await db.query("delete from notifications where url = $1", [`/chats/${sun}`]);
    await db.query("update chat_reads set last_read_at = now() - interval '1 hour' where chat_id = $1", [sun]);
  }
  async function send(text: string) {
    if (!teacher.url().endsWith(`/chats/${sun}`)) {
      await teacher.goto(`/chats/${sun}`);
      await expect(teacher.getByTestId("conversation")).toHaveAttribute("data-live", "true");
    }
    await teacher.getByTestId("composer-input").fill(text);
    await teacher.getByTestId("composer-send").click();
    await expect(teacher.getByTestId("message").filter({ hasText: text }).last()).toBeVisible();
  }
  const parentRow = async () => one("select id, deliver_after, pushed_at, read_at from notifications where user_id = $1 and url = $2", [parentId, `/chats/${sun}`]);

  test("a teacher's chat message reaches the parent's device: encrypted, VAPID-signed, collapsible; the click opens the chat", async ({ browser }) => {
    await freshChat();
    received.length = 0;
    const text = say("Завтра прогулка");
    await send(text);
    await expect.poll(() => received.length).toBe(1);
    const req = received[0];
    expect(req.path).toBe(new URL(endpoint).pathname);
    expect(req.headers["content-encoding"]).toBe("aes128gcm");
    expect(req.headers["ttl"]).toBe("86400");
    expect(req.headers["urgency"]).toBe("high");
    expect(req.headers["topic"]).toBe(sun.replace(/-/g, ""));
    expect(req.headers["authorization"]).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const payload = decrypt(req.body);
    const row = await parentRow();
    expect(payload).toEqual({ id: row.id, title: "Новое сообщение", body: `Нурланова Асель Ериковна · Солнышко: ${text}`, url: `/notifications/${row.id}/open`, tag: `chat:${sun}` });
    expect(row.pushed_at).not.toBeNull();
    expect((await one("select last_used_at from push_subscriptions where endpoint = $1", [endpoint])).last_used_at).not.toBeNull();

    // what the service worker opens on click: marks read and lands in the chat
    const parent = await as(browser, PHONES.parent);
    await parent.goto(payload.url);
    await parent.waitForURL(`**/chats/${sun}`);
    expect((await parentRow()).read_at).not.toBeNull();
    await parent.context().close();
  });

  /** The teacher publishes an announcement to Солнышко (the parent's group); returns its notification row for the parent. */
  async function announce(title: string, important: boolean) {
    await teacher.goto("/announcements");
    await teacher.getByTestId("new-announcement").click();
    await teacher.getByTestId("announcement-title").fill(title);
    await teacher.getByTestId("announcement-body").fill("Подробности у воспитателя.");
    await teacher.getByTestId("group-option-Солнышко").check();
    if (important) await teacher.getByTestId("announcement-important").click();
    await teacher.getByTestId("announcement-submit").click();
    await teacher.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
    const url = new URL(teacher.url()).pathname;
    await expect.poll(async () => (await db.query("select 1 from notifications where user_id = $1 and url = $2", [parentId, url])).rowCount).toBe(1);
    return one("select id, deliver_after, pushed_at from notifications where user_id = $1 and url = $2", [parentId, url]);
  }

  test("quiet hours: chat messages to a parent go out at once; a routine announcement waits for the cron (reader's language), an important one does not", async ({ request }) => {
    await db.query("update kindergarten_settings set quiet_hours_start = '00:00', quiet_hours_end = '23:59' where kindergarten_id = $1", [kgA]);
    await db.query("update profiles set locale = 'kk' where id = $1", [parentId]);
    try {
      // staff → parent chat message: the chat module defers only parent → staff, garden quiet hours are not added
      await freshChat();
      received.length = 0;
      await send(say("Поздний ответ"));
      await expect.poll(() => received.length).toBe(1);
      expect((await parentRow()).deliver_after).toBeNull();
      expect(decrypt(received[0].body)).toMatchObject({ title: "Жаңа хабарлама" });

      // routine announcement: the bell row at once, the push in the morning
      received.length = 0;
      const routine = await announce(say("Плановое объявление"), false);
      expect(routine.deliver_after.getTime()).toBeGreaterThan(Date.now());
      expect(routine.pushed_at).toBeNull();
      expect((await request.get("/api/cron/push-deferred")).status()).toBe(401);
      const c = cron("/api/cron/push-deferred");
      expect((await request.get(c.path, { headers: c.headers })).status()).toBe(200);
      await new Promise((r) => setTimeout(r, 1000));
      expect(received).toHaveLength(0);

      // morning comes
      await db.query("update notifications set deliver_after = now() - interval '1 minute' where id = $1", [routine.id]);
      const res = await request.get(c.path, { headers: c.headers });
      expect(res.status()).toBe(200);
      expect((await res.json()).sent).toBeGreaterThanOrEqual(1);
      await expect.poll(() => received.length).toBe(1);
      expect(decrypt(received[0].body)).toMatchObject({ id: routine.id, title: "Жаңа жарияланым" });
      expect((await one("select pushed_at from notifications where id = $1", [routine.id])).pushed_at).not.toBeNull();
      // idempotent
      await request.get(c.path, { headers: c.headers });
      await new Promise((r) => setTimeout(r, 500));
      expect(received).toHaveLength(1);

      // important announcement: not held back
      received.length = 0;
      const important = await announce(say("Важное объявление"), true);
      expect(important.deliver_after).toBeNull();
      await expect.poll(() => received.length).toBe(1);
      expect(decrypt(received[0].body)).toMatchObject({ id: important.id, title: "Жаңа жарияланым" });
    } finally {
      await db.query("update kindergarten_settings set quiet_hours_start = '00:00', quiet_hours_end = '00:00' where kindergarten_id = $1", [kgA]);
      await db.query("update profiles set locale = 'ru' where id = $1", [parentId]);
    }
  });

  test("a type switched off in the profile gives neither a bell row nor a push", async () => {
    await db.query("insert into notification_preferences (user_id, type, enabled) values ($1, 'message.new', false) on conflict (user_id, type) do update set enabled = false", [parentId]);
    try {
      await freshChat();
      received.length = 0;
      await send(say("Без уведомления"));
      const head = (await one("select id from profiles where phone = $1", [PHONES.head])).id;
      // other members are still notified …
      await expect.poll(async () => (await db.query("select 1 from notifications where user_id = $1 and url = $2", [head, `/chats/${sun}`])).rowCount).toBe(1);
      await new Promise((r) => setTimeout(r, 1000));
      // … the parent is not
      expect(await parentRow()).toBeUndefined();
      expect(received).toHaveLength(0);
    } finally {
      await db.query("delete from notification_preferences where user_id = $1", [parentId]);
    }
  });

  test("a subscription the push service reports gone (410) is removed", async ({ request }) => {
    respondWith = 410;
    try {
      received.length = 0;
      await one(
        "insert into notifications (kindergarten_id, user_id, type, params, url, deliver_after) values ($1, $2, 'announcement.new', $3, '/announcements', now() - interval '1 minute') returning id",
        [kgA, parentId, JSON.stringify({ title: say("Объявление") })],
      );
      const c = cron("/api/cron/push-deferred");
      expect((await request.get(c.path, { headers: c.headers })).status()).toBe(200);
      await expect.poll(() => received.length).toBe(1);
      await expect.poll(async () => (await db.query("select 1 from push_subscriptions where endpoint = $1", [endpoint])).rowCount).toBe(0);
    } finally {
      respondWith = 201;
    }
  });
});

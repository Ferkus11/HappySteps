import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const STAGE = "stage6";
const MARK = "SCR6";
const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
let kgA = "";
let parentId = "";
let ownerId = "";
let cookId = "";

type Row = [type: string, params: Record<string, unknown>, url: string, ageMinutes: number, read: boolean];

async function seed(user: string, rows: Row[]) {
  for (const [type, params, url, age, read] of rows) {
    await db.query(
      `insert into notifications (kindergarten_id, user_id, type, params, url, created_at, read_at, pushed_at)
       values ($1, $2, $3, $4, $5, now() - make_interval(mins => $6), case when $7 then now() end, now())`,
      [kgA, user, type, JSON.stringify({ ...params, mark: MARK }), url, age, read],
    );
  }
}

test.beforeAll(async () => {
  kgA = (await one("select id from kindergartens where slug = 'e2e-a'")).id;
  parentId = (await one("select id from profiles where phone = $1", [PHONES.parent])).id;
  ownerId = (await one("select id from profiles where phone = $1", [PHONES.owner])).id;
  cookId = (await one("select id from profiles where phone = $1", [PHONES.cook])).id;
  await db.query("delete from notifications where params->>'mark' = $1", [MARK]);
  await db.query("update notifications set read_at = now() where user_id = any($1) and read_at is null", [[parentId, ownerId, cookId]]);
  // Older rows of other specs stay out of the pictures.
  await db.query("update notifications set created_at = created_at - interval '30 days' where user_id = any($1) and created_at > now() - interval '3 days'", [[parentId, ownerId, cookId]]);
  await db.query("delete from notification_preferences where user_id = any($1)", [[parentId, ownerId]]);
  await seed(parentId, [
    ["message.new", { from: "Нурланова Асель Ериковна · Солнышко", text: "Завтра прогулка в парке, оденьте детей потеплее" }, "/chats", 3, false],
    ["receipt.rejected", { month: "2026-10", reason: "На фото не видна сумма" }, "/payments", 40, false],
    ["message.new", { from: "Касымова Жанар Нурлановна · Солнышко", deleted: "yes" }, "/chats", 50, true],
    ["event.reminder", { title: "Осенний утренник", date: "15.10.2026", time: "10:00–11:00", place: "Музыкальный зал" }, "/events", 120, true],
    ["club.decision", { club: "Шахматы", child: "Алихан", status: "active" }, "/clubs", 60 * 24 + 30, true],
    ["announcement.new", { title: "Родительское собрание в пятницу" }, "/announcements", 60 * 24 + 90, true],
    ["receipt.accepted", { month: "2026-09", amount: "85 000 ₸" }, "/payments", 60 * 24 * 3, true],
  ]);
  await seed(ownerId, [
    ["waitlist.new", { child: "Сериков Арман", parent: "Серикова Дана" }, "/waitlist", 5, false],
    ["attendance.not_marked", { group: "Звёздочки" }, "/attendance", 90, false],
    ["document.expiring", { person: "Ким Елена Викторовна", document: "Медицинская книжка", date: "12.11.2026" }, "/documents", 60 * 24 + 10, true],
  ]);
  await db.query("insert into notification_preferences (user_id, type, enabled) values ($1, 'announcement.reminder', false), ($1, 'club.spot_free', false)", [ownerId]);
});

test.afterAll(async () => {
  await db.query("delete from notifications where params->>'mark' = $1", [MARK]);
  await db.query("delete from notification_preferences where user_id = any($1)", [[parentId, ownerId]]);
  await db.end();
});

async function setLocale(page: Page, locale: "ru" | "kk") {
  await page.context().addCookies([{ name: "hs_locale", value: locale, url: new URL(page.url()).origin }]);
}

/** Browser push APIs for a given state (headless Chromium has no push service). */
async function pushApis(ctx: BrowserContext, state: "off" | "on" | "blocked" | "unsupported" | "ios") {
  await ctx.addInitScript((s) => {
    if (s === "unsupported" || s === "ios") {
      // @ts-expect-error — simulate a browser without the Push API
      delete window.PushManager;
      if (s === "ios") Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" });
      return;
    }
    const N = { permission: s === "blocked" ? "denied" : s === "on" ? "granted" : "default", requestPermission: async () => "granted" };
    Object.defineProperty(window, "Notification", { value: N, configurable: true });
    Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/screens", toJSON: () => ({}), unsubscribe: async () => true };
    const reg = { active: {}, addEventListener() {}, pushManager: { getSubscription: async () => (s === "on" ? sub : null), subscribe: async () => sub } };
    Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} }, configurable: true });
  }, state);
}

test("centre · parent (ru, kk)", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.goto("/notifications");
  await expect(page.getByTestId("notification").first()).toContainText("Завтра прогулка");
  await snap(page, STAGE, "notifications-parent-centre");
  await setLocale(page, "kk");
  await page.reload();
  await expect(page.getByTestId("notification-list")).toContainText("Бүгін");
  await snap(page, STAGE, "notifications-parent-centre-kk");
});

test("centre · owner, empty state (cook)", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.goto("/notifications");
  await expect(page.getByTestId("notification").first()).toBeVisible();
  await snap(page, STAGE, "notifications-owner-centre");
  await login(page, PHONES.cook);
  await page.goto("/notifications");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("notifications-read-all")).toHaveCount(0);
  await snap(page, STAGE, "notifications-cook-centre");
});

for (const state of ["off", "on", "blocked", "unsupported", "ios"] as const) {
  test(`profile · push card ${state}`, async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty" });
    await pushApis(ctx, state);
    const page = await ctx.newPage();
    await login(page, state === "off" ? PHONES.owner : PHONES.parent);
    await page.goto("/profile");
    await expect(page.getByTestId("push-card")).toHaveAttribute("data-state", state);
    await snap(page, STAGE, `profile-${state === "off" ? "owner" : "parent"}-push-${state}`);
    if (state === "on") {
      await setLocale(page, "kk");
      await page.reload();
      await expect(page.getByTestId("push-card")).toHaveAttribute("data-state", "on");
      await snap(page, STAGE, "profile-parent-push-on-kk");
    }
    await ctx.close();
  });
}

test("dashboard · «Включите уведомления» prompt (parent ru, kk; teacher on iPhone)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await pushApis(ctx, "off");
  const page = await ctx.newPage();
  await login(page, PHONES.parent);
  await expect(page.getByTestId("push-prompt")).toBeVisible();
  await snap(page, STAGE, "dashboard-parent-push-prompt");
  await setLocale(page, "kk");
  await page.reload();
  await expect(page.getByTestId("push-prompt")).toContainText("Хабарландыруларды қосыңыз");
  await snap(page, STAGE, "dashboard-parent-push-prompt-kk");
  await ctx.close();

  const ios = await browser.newContext({ locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await pushApis(ios, "ios");
  const teacher = await ios.newPage();
  await login(teacher, PHONES.teacher);
  await expect(teacher.getByTestId("push-prompt")).toHaveAttribute("data-state", "ios");
  await snap(teacher, STAGE, "dashboard-teacher-push-prompt-ios");
  await ios.close();
});

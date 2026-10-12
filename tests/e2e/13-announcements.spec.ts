import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { PHONES, expectToast, login, switchContext } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const TITLE = `E2E важное ${Date.now().toString(36)}`;
// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let annPath = "";
let sunId = "";

test.beforeAll(async () => {
  // Re-runnable: drop announcements created by earlier runs of this spec.
  await db.query("delete from announcements where title like 'E2E %'");
});
test.afterAll(async () => {
  // Keep other suites' assumptions (e.g. notifications RLS test) intact on a re-used DB.
  await db.query("delete from notifications where url like '/announcements/%' or url like '/events%'");
  await db.end();
});

async function ensureTeacherContext(page: Page) {
  if (!(await page.getByTestId("account-menu").innerText()).includes("Воспитатель")) {
    await switchContext(page, "Happy Steps E2E", "Воспитатель");
  }
}

test("head publishes an important announcement to Солнышко with a photo", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/announcements");
  await page.getByTestId("new-announcement").click();
  await page.getByTestId("announcement-title").fill(TITLE);
  await page.getByTestId("announcement-body").fill("Завтра в группе плановый осмотр врача. Пожалуйста, не опаздывайте.");
  await page.locator("label", { has: page.getByTestId("audience-groups") }).click();
  sunId = (await page.getByTestId("group-option-Солнышко").getAttribute("data-group-id")) ?? "";
  expect(sunId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByTestId("group-option-Солнышко").check();
  await page.getByTestId("announcement-important").click();
  await page.getByTestId("announcement-photos").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("announcement-submit").click();
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  annPath = new URL(page.url()).pathname;
  await expect(page.getByTestId("announcement-heading")).toHaveText(TITLE);
  await expect(page.getByTestId("announcement-gallery").locator("img")).toHaveCount(1);
  await expect(page.getByTestId("read-count")).toHaveText(/Прочитали 0 из \d+/);
  await expect(page.getByTestId("unread-list")).toContainText("Ахметов Данияр");
  // recipients got "announcement.new" (author excluded)
  const n = await db.query("select count(*)::int as n from notifications where type = 'announcement.new' and url = $1", [annPath]);
  expect(n.rows[0].n).toBeGreaterThan(0);
});

test("parent sees it pinned on the dashboard, opens it and it becomes read", async ({ page }) => {
  await login(page, PHONES.parent);
  const widget = page.getByTestId("important-announcements");
  const item = widget.getByTestId("announcement-item").filter({ hasText: TITLE });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("unread-dot")).toBeVisible();
  await page.goto("/announcements");
  await expect(page.getByTestId("announcement-item").first()).toContainText(TITLE); // pinned on top
  await expect(page.getByTestId("announcement-item").first()).toHaveAttribute("data-important", "true");
  await page.getByTestId("announcement-item").first().click();
  await expect(page.getByTestId("announcement-heading")).toHaveText(TITLE);
  await expect(page.getByTestId("announcement-gallery").locator("img")).toHaveCount(1);
  await expect(page.getByTestId("read-stats")).toHaveCount(0); // readers don't see stats
  await expect(async () => {
    await page.goto("/announcements");
    await expect(page.getByTestId("announcement-item").filter({ hasText: TITLE }).getByTestId("unread-dot")).toHaveCount(0);
  }).toPass({ timeout: 10_000 });
});

test("head sees read stats without the parent and sends a reminder (once per hour)", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto(annPath);
  await expect(page.getByTestId("read-count")).toHaveText(/Прочитали 1 из \d+/);
  await expect(page.getByTestId("unread-list")).not.toContainText("Ахметов Данияр");
  await expect(page.getByTestId("unread-list")).toContainText("Нурланова Асель");
  await page.getByTestId("remind").click();
  await expectToast(page, /Напоминание отправлено/);
  await expect(page.getByTestId("remind")).toBeDisabled();
  const r = await db.query(
    "select p.phone from notifications n join profiles p on p.id = n.user_id where n.type = 'announcement.reminder' and n.url = $1",
    [annPath],
  );
  const phones = r.rows.map((x) => x.phone);
  expect(phones).toContain(PHONES.teacher);
  expect(phones).not.toContain(PHONES.parent); // already read
  await page.reload();
  await expect(page.getByTestId("remind")).toBeDisabled();
});

test("teacher-parent as teacher publishes only to Звёздочки; a forged group is rejected", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  await ensureTeacherContext(page);
  await page.goto("/announcements");
  await page.getByTestId("new-announcement").click();
  await expect(page.getByTestId("audience-all")).toHaveCount(0);
  await expect(page.getByTestId("audience-staff")).toHaveCount(0);
  await expect(page.getByTestId("group-option-Звёздочки")).toBeVisible();
  await expect(page.getByTestId("group-option-Солнышко")).toHaveCount(0);
  await page.getByTestId("announcement-title").fill(`E2E подделка ${Date.now()}`);
  // Forge the request: point the Звёздочки checkbox at Солнышко.
  await page.getByTestId("group-option-Звёздочки").evaluate((el, id) => ((el as HTMLInputElement).value = id), sunId);
  await page.getByTestId("group-option-Звёздочки").check();
  await page.getByTestId("announcement-submit").click();
  await expectToast(page, "Недостаточно прав для этого действия.");
  expect((await db.query("select 1 from announcements where title like 'E2E подделка%'")).rowCount).toBe(0);
  // A legitimate post to own group works.
  await page.getByTestId("group-option-Звёздочки").evaluate((el) => {
    (el as HTMLInputElement).value = (el as HTMLInputElement).dataset.groupId ?? "";
  });
  await page.getByTestId("announcement-title").fill(`E2E Звёздочки ${Date.now()}`);
  await page.getByTestId("announcement-submit").click();
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("announcement-heading")).toContainText("E2E Звёздочки");
});

test("parent of another kindergarten sees nothing", async ({ page }) => {
  await login(page, PHONES.parentB);
  await page.goto("/announcements");
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await expect(page.getByTestId("announcement-item")).toHaveCount(0);
  await page.goto(annPath);
  await expect(page.getByTestId("announcement-heading")).toHaveCount(0);
});

test("audiences per role: staff-only hidden from parents, group posts hidden from other staff", async ({ page }) => {
  await login(page, PHONES.cook);
  await page.goto("/announcements");
  await expect(page.getByText("Планёрка в пятницу")).toBeVisible();
  await expect(page.getByText("Принесите сменную одежду")).toHaveCount(0);
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await expect(page.getByTestId("new-announcement")).toHaveCount(0);
  await login(page, PHONES.parent);
  await page.goto("/announcements");
  await expect(page.getByText("Принесите сменную одежду")).toBeVisible();
  await expect(page.getByText("Планёрка в пятницу")).toHaveCount(0);
  await expect(page.getByTestId("new-announcement")).toHaveCount(0);
});

test("head deletes the announcement (audited)", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto(annPath);
  await page.getByTestId("delete-announcement").click();
  await page.getByTestId("confirm-ok").click();
  await page.waitForURL(/\/announcements$/);
  await expect(page.getByText(TITLE)).toHaveCount(0);
  const a = await db.query("select details from audit_log where action = 'announcement.delete' and entity_id = $1", [annPath.split("/").pop()]);
  expect(a.rows[0]?.details?.files).toBe(1);
});

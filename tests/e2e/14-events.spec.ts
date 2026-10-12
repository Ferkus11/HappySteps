import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { PHONES, login } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const TITLE = `E2E событие ${Date.now().toString(36)}`;
const almatyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Next occurrence (today or later) of a birthday. */
const nextBirthday = (birth: string, today: string) => {
  const y = Number(today.slice(0, 4));
  const thisYear = `${y}${birth.slice(4)}`;
  return thisYear >= today ? thisYear : `${y + 1}${birth.slice(4)}`;
};
const today = almatyToday();
const tomorrow = plusDays(today, 1);

test.beforeAll(async () => {
  await db.query("delete from events where title like 'E2E %'");
});
test.afterAll(async () => {
  // Keep other suites' assumptions (e.g. notifications RLS test) intact on a re-used DB.
  await db.query("delete from notifications where url like '/announcements/%' or url like '/events%'");
  await db.end();
});

test("head creates an event for tomorrow for Солнышко", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/events");
  await expect(page.getByTestId("calendar-grid")).toBeVisible();
  await page.getByTestId("new-event").click();
  await page.getByTestId("event-title").fill(TITLE);
  await page.getByTestId("event-kind").selectOption("parent_meeting");
  await page.getByTestId("event-date").fill(tomorrow);
  await page.getByTestId("event-start").fill("07:30");
  await page.getByLabel("Место").fill("Музыкальный зал");
  await page.locator("label", { has: page.getByTestId("audience-groups") }).click();
  await page.getByTestId("group-option-Солнышко").check();
  await page.getByTestId("event-submit").click();
  await page.waitForURL(new RegExp(`/events\\?month=${tomorrow.slice(0, 7)}&day=${tomorrow}`));
  await expect(page.getByTestId(`day-${tomorrow}`)).toContainText(TITLE);
  await expect(page.getByTestId("selected-day")).toContainText(TITLE);
  await expect(page.getByTestId("upcoming-list")).toContainText(TITLE);
  // details dialog
  await page.getByTestId("selected-day").getByTestId("event-row").filter({ hasText: TITLE }).click();
  await expect(page.getByTestId("event-details")).toContainText("07:30");
  await expect(page.getByTestId("event-details")).toContainText("Солнышко");
});

test("the audience sees it in «Ближайшие» and in the month calendar; others don't", async ({ page }) => {
  await login(page, PHONES.parent);
  await expect(page.getByTestId("upcoming-events")).toContainText(TITLE);
  await page.goto(`/events?month=${tomorrow.slice(0, 7)}`);
  await expect(page.getByTestId(`day-${tomorrow}`)).toContainText(TITLE);
  await expect(page.getByTestId("upcoming-list")).toContainText(TITLE);
  await expect(page.getByTestId("new-event")).toHaveCount(0);
  await expect(page.getByTestId("upcoming-list")).not.toContainText("Педсовет"); // staff only

  await login(page, PHONES.cook);
  await page.goto("/events");
  await expect(page.getByTestId("upcoming-list")).not.toContainText(TITLE);
  await expect(page.getByTestId("upcoming-list")).toContainText("Педсовет");

  await login(page, PHONES.parentB);
  await page.goto(`/events?month=${tomorrow.slice(0, 7)}`);
  await expect(page.getByText(TITLE)).toHaveCount(0);
});

test("teacher of Солнышко cannot target other groups", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/events");
  await page.getByTestId("new-event").click();
  await expect(page.getByTestId("audience-all")).toHaveCount(0);
  await expect(page.getByTestId("group-option-Солнышко")).toBeVisible();
  await expect(page.getByTestId("group-option-Звёздочки")).toHaveCount(0);
});

test("birthdays: parent sees own child's, not other children's; head sees all", async ({ page }) => {
  const r = await db.query("select full_name, birth_date::text as b from children where full_name in ('Ахметов Алихан Даниярович', 'Касымова Айлин Нурлановна')");
  const birth = Object.fromEntries(r.rows.map((x) => [x.full_name.split(" ")[1], x.b as string]));
  const alikhan = nextBirthday(birth["Алихан"], today);
  const aylin = nextBirthday(birth["Айлин"], today);

  await login(page, PHONES.parent);
  await page.goto(`/events?month=${alikhan.slice(0, 7)}&day=${alikhan}`);
  await expect(page.getByTestId("selected-day").getByTestId("birthday-item")).toContainText("Ахметов Алихан");
  await page.goto(`/events?month=${aylin.slice(0, 7)}&day=${aylin}`);
  await expect(page.getByTestId("selected-day")).not.toContainText("Айлин");
  await expect(page.getByTestId("calendar-grid")).not.toContainText("Айлин");

  await login(page, PHONES.head);
  await page.goto(`/events?month=${aylin.slice(0, 7)}&day=${aylin}`);
  await expect(page.getByTestId("selected-day").getByTestId("birthday-item")).toContainText("Касымова Айлин");
});

test("head edits and deletes the event", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto(`/events?month=${tomorrow.slice(0, 7)}&day=${tomorrow}`);
  await page.getByTestId("selected-day").getByTestId("event-row").filter({ hasText: TITLE }).click();
  await page.getByTestId("edit-event").click();
  await page.getByTestId("event-start").fill("08:15");
  await page.getByTestId("event-submit").click();
  await expect(page.getByTestId("selected-day")).toContainText("08:15");
  await page.getByTestId("selected-day").getByTestId("event-row").filter({ hasText: TITLE }).click();
  await page.getByTestId("delete-event").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("selected-day")).not.toContainText(TITLE);
});

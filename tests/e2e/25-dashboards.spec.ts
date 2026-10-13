import { expect, test, type Page } from "@playwright/test";
import { PHONES, login, switchContext } from "./helpers";
import { prepareDashboards, type DashState } from "./dashboards-setup";

test.describe.configure({ mode: "serial" });

let S: DashState;

test.beforeAll(async () => {
  S = await prepareDashboards();
});

test.afterAll(async () => {
  await S?.restore();
});

/** Dashboard of the current role, every widget streamed in. */
async function dashboard(page: Page, role: string) {
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", role);
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
}

const visible = (page: Page, ids: string[]) => Promise.all(ids.map((id) => expect(page.getByTestId(id).first(), id).toBeVisible()));
const absent = (page: Page, ids: string[]) => Promise.all(ids.map((id) => expect(page.getByTestId(id), id).toHaveCount(0)));

const ADMIN_ONLY = ["dash-stats", "attention-card", "waitlist-widget"];
const PARENT_ONLY = ["parent-today", "my-child", "parent-payment"];
const STAFF_ONLY = ["workday-card", "receipts-pending", "timesheet-widget", "menu-kitchen", "portions-card", "teacher-today"];

test("owner: top row with payments, work time, menu, events; right column with attention and waitlist", async ({ page }) => {
  await login(page, PHONES.owner);
  await dashboard(page, "owner");
  await visible(page, ["dash-children", "dash-groups", "dash-attendance-present", "dash-payments", "worktime-staff-list", "menu-today", "upcoming-events", "attention-card", "waitlist-widget"]);
  await absent(page, [...PARENT_ONLY, "receipts-pending", "teacher-today", "menu-kitchen", "timesheet-widget"]);
  // Every top-row card leads to its section.
  await expect(page.getByTestId("dash-children-card")).toHaveAttribute("href", "/children");
  await expect(page.getByTestId("dash-groups-card")).toHaveAttribute("href", "/groups");
  // The right column holds the side cards on desktop.
  await expect(page.locator('[data-slot="side"] [data-testid="attention-card"]')).toBeVisible();
  await expect(page.locator('[data-slot="side"] [data-testid="waitlist-widget"]')).toBeVisible();
});

test("head: same layout without «Оплаты месяца»; receipts are view-only", async ({ page }) => {
  await login(page, PHONES.head);
  await dashboard(page, "head");
  await visible(page, ["dash-children", "dash-groups", "dash-attendance-present", "attention-card", "waitlist-widget", "menu-today"]);
  await absent(page, ["dash-payments", ...PARENT_ONLY, "receipts-pending"]);
  await expect(page.locator('[data-testid="attention-item"][data-kind="receipts"]')).toContainText("Проверяет бухгалтер");
});

test("«Требует внимания»: an unmarked group and a receipt awaiting review, the links lead to the sections", async ({ page }) => {
  await login(page, PHONES.head);
  await dashboard(page, "head");
  const card = page.getByTestId("attention-card");
  const receipts = card.locator('[data-testid="attention-item"][data-kind="receipts"]');
  const groups = card.locator('[data-testid="attention-item"][data-kind="unmarkedGroups"]');
  await expect(receipts).toBeVisible();
  expect(Number(await receipts.getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await expect(groups).toBeVisible();
  expect(Number(await groups.getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await expect(card.getByTestId("attention-empty")).toHaveCount(0);

  await receipts.click();
  await page.waitForURL("**/payments");
  await expect(page.getByTestId("pending-count")).toBeVisible();

  await dashboard(page, "head");
  await page.getByTestId("attention-card").locator('[data-kind="unmarkedGroups"]').click();
  await page.waitForURL(/\/attendance/);
  await expect(page.getByTestId("attendance-progress")).toBeVisible();

  // The owner sees the same receipt line, with the action hint.
  await login(page, PHONES.owner);
  await dashboard(page, "owner");
  await expect(page.locator('[data-testid="attention-item"][data-kind="receipts"]')).toContainText("Подтвердите или отклоните оплату");
});

test("accountant: receipts, debtors, accrued/paid, timesheet — no owner cards", async ({ page }) => {
  await login(page, PHONES.accountant);
  await dashboard(page, "accountant");
  await visible(page, ["receipts-pending", "dash-debtors", "accrued-paid", "timesheet-widget"]);
  expect(Number(await page.getByTestId("receipts-pending").getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "upcoming-events", "worktime-staff-list"]);
  await page.getByTestId("timesheet-open").click();
  await page.waitForURL(/\/worktime\/timesheet/);
});

test("teacher: work day, my group today with «Отметить», menu, group chat, events", async ({ page }) => {
  await login(page, PHONES.teacher);
  await dashboard(page, "teacher");
  await visible(page, ["workday-card", "teacher-today", "teacher-mark", "menu-today", "widget-group-chat", "upcoming-events"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "receipts-pending", "menu-kitchen"]);
});

test("cook: menu today/tomorrow, portions by group, allergies", async ({ page }) => {
  await login(page, PHONES.cook);
  await dashboard(page, "cook");
  await visible(page, ["menu-kitchen", "menu-kitchen-today", "menu-kitchen-tomorrow", "portions-card", "allergies-list"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "receipts-pending", "teacher-today"]);
});

test("club teacher: work day, my clubs and requests, chats", async ({ page }) => {
  await login(page, PHONES.clubTeacher);
  await dashboard(page, "club_teacher");
  await visible(page, ["workday-card", "widget-chats"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "portions-card", "receipts-pending", "teacher-today"]);
});

test("parent: child card with today's status and «Ребёнок не придёт», menu, payment, events — no staff cards", async ({ page }) => {
  await login(page, PHONES.parent);
  await dashboard(page, "parent");
  await visible(page, ["parent-today", "my-child", "child-today-status", "report-absence", "menu-today", "upcoming-events"]);
  await expect(page.getByTestId("my-child")).toContainText("Алихан");
  await absent(page, [...ADMIN_ONLY, ...STAFF_ONLY, "dash-payments", "widget-group-chat"]);
});

test("teacher who is also a parent sees the dashboard of the current role", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  await switchContext(page, "Happy Steps E2E", "Родитель");
  await dashboard(page, "parent");
  await expect(page.getByTestId("my-child")).toContainText("Миша");
  await absent(page, ["teacher-today", "workday-card"]);
  await switchContext(page, "Happy Steps E2E", "Воспитатель");
  await dashboard(page, "teacher");
  await expect(page.getByTestId("teacher-today").first()).toContainText("Звёздочки");
  await absent(page, ["parent-today", "my-child"]);
});

/**
 * Checks of the «Happy Steps» demo dataset (scripts/seed/demo.ts). Skipped unless DEMO=1:
 *   npm run db:seed && DEMO=1 E2E_PORT=3110 npx playwright test --project=e2e tests/e2e/90-demo.spec.ts
 * The demo lives next to the e2e fixtures (own garden and phone range), so it never affects the regular suite.
 */
import { expect, test, type Page } from "@playwright/test";
import { login, switchContext } from "./helpers";
import { DEMO, DEMO_PASSWORD } from "./demo-logins";

test.skip(process.env.DEMO !== "1", "demo dataset: run `npm run db:seed` and set DEMO=1");

/** Collects uncaught page errors and server errors while a test runs. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });
  return problems;
}

async function expectClean(page: Page, problems: string[]) {
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/NaN|undefined|Invalid Date|Application error/);
  expect(problems).toEqual([]);
}

const ROLES: [keyof typeof DEMO, string][] = [
  ["owner", "owner"],
  ["head", "head"],
  ["accountant", "accountant"],
  ["teacher", "teacher"],
  ["clubTeacher", "club_teacher"],
  ["cook", "cook"],
  ["parent", "parent"],
  ["teacherParent", "teacher"],
];

for (const [who, role] of ROLES) {
  test(`demo dashboard · ${who}`, async ({ page }) => {
    const problems = watch(page);
    await login(page, DEMO[who], DEMO_PASSWORD);
    await page.goto("/");
    await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", role);
    await expectClean(page, problems);
  });
}

test("demo · superadmin sees the garden", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.superadmin, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/admin/);
  expect(problems).toEqual([]);
});

test("demo · teacher who is also a parent switches roles", async ({ page }) => {
  await login(page, DEMO.teacherParent, DEMO_PASSWORD);
  await switchContext(page, "Happy Steps", "Родитель");
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", "parent");
  await switchContext(page, "Happy Steps", "Воспитатель");
});

test("demo · owner analytics has data in every section", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.owner, DEMO_PASSWORD);
  await page.goto("/analytics");
  await expect(page.getByTestId("section-attendance")).toBeVisible();
  await expect(page.getByTestId("kpi-attendance-value")).toHaveText(/^\d+%$/);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  for (const tab of ["staff", "finance", "funnel"]) {
    await page.getByTestId(`analytics-tab-${tab}`).click();
    await expect(page.getByTestId(`section-${tab}`)).toBeVisible();
    await expect(page.getByTestId("analytics-empty")).toHaveCount(0);
  }
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await expectClean(page, problems);
});

test("demo · accountant: receipts to check and debtors", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.accountant, DEMO_PASSWORD);
  await page.goto("/payments");
  await expect(page.getByTestId("pending-count")).toHaveText(/^[1-9]\d*$/);
  await page.goto("/payments?tab=debtors");
  await expect(page.getByTestId("debtors-list")).toBeVisible();
  expect(await page.getByTestId("debtor-row").count()).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("debtors-total")).toContainText("₸");
  await expectClean(page, problems);
});

test("demo · head: the chess club is full with a queue", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.head, DEMO_PASSWORD);
  await page.goto("/clubs");
  const chess = page.getByTestId("club-card").filter({ hasText: "Шахматы" });
  await expect(chess.getByTestId("club-places")).toHaveAttribute("data-free", "0");
  await expect(chess.getByTestId("club-places")).toContainText("3 в очереди");
  await expectClean(page, problems);
});

test("demo · owner: twelve waitlist applications", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.owner, DEMO_PASSWORD);
  await page.goto("/waitlist?tab=all");
  await expect(page.getByTestId("wl-row")).toHaveCount(12);
  await expect(page.getByTestId("wl-tab-all")).toContainText("12");
  await expectClean(page, problems);
});

test("demo · parent: two children, payment and clubs", async ({ page }) => {
  const problems = watch(page);
  await login(page, DEMO.parent, DEMO_PASSWORD);
  await page.goto("/payments");
  await expect(page.getByTestId("parent-child-payments").first()).toBeVisible();
  await page.goto("/clubs");
  await expect(page.locator('[data-testid="enrollment-status"][data-status="queued"]').first()).toBeVisible();
  await expectClean(page, problems);
});

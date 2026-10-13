/**
 * Screenshots of the «Happy Steps» demo for every role (390 + 1440) → screenshots/stage7/demo-*.png.
 * Skipped unless DEMO=1 (needs `npm run db:seed` — the demo dataset, not the e2e fixtures):
 *   DEMO=1 E2E_PORT=3110 npm run screens -- tests/screens/stage7-demo.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { snap } from "./helpers";
import { login, switchContext } from "../e2e/helpers";
import { DEMO, DEMO_PASSWORD } from "../e2e/demo-logins";

test.skip(process.env.DEMO !== "1", "demo dataset: run `npm run db:seed` and set DEMO=1");
test.describe.configure({ mode: "serial" });

const STAGE = "stage7";

async function settle(page: Page) {
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function dashboard(page: Page, role: string, name: string) {
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", role);
  await settle(page);
  await snap(page, STAGE, name);
}

const ROLES: [keyof typeof DEMO, string][] = [
  ["owner", "owner"],
  ["head", "head"],
  ["accountant", "accountant"],
  ["teacher", "teacher"],
  ["clubTeacher", "club_teacher"],
  ["cook", "cook"],
  ["parent", "parent"],
];

for (const [who, role] of ROLES) {
  test(`demo dashboard · ${role}`, async ({ page }) => {
    await login(page, DEMO[who], DEMO_PASSWORD);
    await dashboard(page, role, `demo-${role}`);
  });
}

test("demo · teacher+parent as parent", async ({ page }) => {
  await login(page, DEMO.teacherParent, DEMO_PASSWORD);
  await switchContext(page, "Happy Steps", "Родитель");
  await dashboard(page, "parent", "demo-teacherparent-as-parent");
  await switchContext(page, "Happy Steps", "Воспитатель");
});

test("demo · superadmin", async ({ page }) => {
  await login(page, DEMO.superadmin, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/admin/);
  await settle(page);
  await snap(page, STAGE, "demo-superadmin");
});

/** The last three months — the whole demo history (custom period). */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
const from = new Date(Date.parse(`${today}T00:00:00Z`) - 91 * 86400_000).toISOString().slice(0, 10);
const QUARTER = `p=custom&from=${from}&to=${today}`;

const SCREENS: [keyof typeof DEMO, string, string][] = [
  ["owner", "/analytics", "demo-owner-analytics-attendance"],
  ["owner", "/analytics?tab=staff", "demo-owner-analytics-staff"],
  ["owner", `/analytics?tab=finance&${QUARTER}`, "demo-owner-analytics-finance"],
  ["owner", `/analytics?tab=funnel&${QUARTER}`, "demo-owner-analytics-funnel"],
  ["owner", "/waitlist?tab=all", "demo-owner-waitlist"],
  ["head", "/worktime", "demo-head-worktime"],
  ["head", "/clubs", "demo-head-clubs"],
  ["head", "/attendance", "demo-head-attendance"],
  ["accountant", "/payments", "demo-accountant-review"],
  ["accountant", "/payments?tab=debtors", "demo-accountant-debtors"],
  ["teacher", "/attendance", "demo-teacher-attendance"],
  ["teacher", "/chats", "demo-teacher-chats"],
  ["parent", "/payments", "demo-parent-payments"],
  ["parent", "/announcements", "demo-parent-announcements"],
  ["cook", "/menu", "demo-cook-menu"],
  ["clubTeacher", "/clubs", "demo-club_teacher-clubs"],
];

for (const [who, path, name] of SCREENS) {
  test(`demo screen · ${name}`, async ({ page }) => {
    await login(page, DEMO[who], DEMO_PASSWORD);
    await page.goto(path);
    await settle(page);
    await snap(page, STAGE, name);
  });
}

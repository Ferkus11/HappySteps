import { expect, test, type Page } from "@playwright/test";
import { snap } from "./helpers";
import { PHONES, login, switchContext } from "../e2e/helpers";
import { prepareDashboards, type DashState } from "../e2e/dashboards-setup";

test.describe.configure({ mode: "serial" });

const STAGE = "stage5";
let S: DashState;

test.beforeAll(async () => {
  S = await prepareDashboards();
});

test.afterAll(async () => {
  await S?.restore();
});

async function setLocale(page: Page, locale: "ru" | "kk") {
  await page.context().addCookies([{ name: "hs_locale", value: locale, url: new URL(page.url()).origin }]);
}

async function shoot(page: Page, role: string, name: string) {
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", role);
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await snap(page, STAGE, name);
}

const ROLES: [keyof typeof PHONES, string][] = [
  ["owner", "owner"],
  ["head", "head"],
  ["accountant", "accountant"],
  ["teacher", "teacher"],
  ["clubTeacher", "club_teacher"],
  ["cook", "cook"],
  ["parent", "parent"],
];

for (const [who, role] of ROLES) {
  test(`dashboard · ${role}`, async ({ page }) => {
    await login(page, PHONES[who]);
    await shoot(page, role, `dashboard-${role}`);
  });
}

test("dashboard · teacher+parent as parent", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  await switchContext(page, "Happy Steps E2E", "Родитель");
  await shoot(page, "parent", "dashboard-teacherparent-as-parent");
  await switchContext(page, "Happy Steps E2E", "Воспитатель");
});

test("dashboard · kk (owner, parent)", async ({ page }) => {
  for (const [who, role] of [
    ["owner", "owner"],
    ["parent", "parent"],
  ] as const) {
    await login(page, PHONES[who]);
    await setLocale(page, "kk");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Сәлеметсіз бе");
    await shoot(page, role, `dashboard-${role}-kk`);
    await setLocale(page, "ru");
  }
});

import { test, type Page } from "@playwright/test";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

/** Stage 7B: the main screen of every role in Kazakh (and a few busy screens), for a visual check of the copy. */

const ROLES: [role: string, phone: string, extra: string[]][] = [
  ["owner", PHONES.owner, ["/analytics", "/payments", "/worktime/timesheet", "/events"]],
  ["head", PHONES.head, ["/attendance", "/children"]],
  ["accountant", PHONES.accountant, ["/payments"]],
  ["teacher", PHONES.teacher, ["/attendance", "/chats"]],
  ["club_teacher", PHONES.clubTeacher, ["/clubs"]],
  ["cook", PHONES.cook, ["/menu"]],
  ["parent", PHONES.parent, ["/payments", "/clubs"]],
  ["superadmin", PHONES.superadmin, []],
];

async function kk(page: Page) {
  const url = new URL(page.url());
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: url.origin }]);
}

async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.locator("[data-skeleton]").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
}

for (const [role, phone, extra] of ROLES) {
  test(`stage 7 · ${role} in Kazakh`, async ({ page }) => {
    await login(page, phone);
    await kk(page);
    const home = role === "superadmin" ? "/admin" : "/";
    for (const p of [home, ...extra]) {
      await page.goto(p);
      await settle(page);
      const name = p === "/" ? "dashboard" : p.slice(1).replace(/\//g, "-");
      await snap(page, "stage7", `kk-${role}-${name}`);
    }
  });
}

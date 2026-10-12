import { test } from "@playwright/test";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

test.describe.configure({ mode: "serial" });

test("stage 1 · owner", async ({ page }) => {
  await login(page, PHONES.owner);
  await snap(page, "stage1", "owner-dashboard");
  for (const p of ["staff", "groups", "children", "audit", "settings"]) {
    await page.goto(`/${p}`);
    await snap(page, "stage1", `owner-${p}`);
  }
  await page.goto("/children");
  await page.getByTestId("child-row").first().click();
  await page.waitForURL(/\/children\/.+/);
  await snap(page, "stage1", "owner-child-card");
  await page.goto("/groups");
  await page.getByTestId("group-Солнышко").click();
  await page.waitForURL(/\/groups\/.+/);
  await snap(page, "stage1", "owner-group");
  await page.goto("/children");
  await page.getByTestId("add-child").first().click();
  await snap(page, "stage1", "owner-add-child");
});

test("stage 1 · other roles", async ({ page }) => {
  await login(page, PHONES.parent);
  await snap(page, "stage1", "parent-dashboard");
  await login(page, PHONES.teacher);
  await page.goto("/children");
  await snap(page, "stage1", "teacher-children");
  await login(page, PHONES.superadmin);
  await snap(page, "stage1", "superadmin-admin");
  await login(page, PHONES.head);
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: "http://localhost:3100" }]);
  await page.goto("/staff");
  await snap(page, "stage1", "head-staff-kk");
});

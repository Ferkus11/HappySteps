import { test } from "@playwright/test";
import { snap } from "./helpers";

test("stage 0 screens", async ({ page }) => {
  await page.goto("/login");
  await snap(page, "stage0", "login-ru");
  await page.goto("/styleguide?role=owner");
  await snap(page, "stage0", "styleguide-owner");
  await page.goto("/styleguide?role=parent");
  await snap(page, "stage0", "styleguide-parent");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: "http://localhost:3100" }]);
  await page.goto("/login");
  await snap(page, "stage0", "login-kk");
});

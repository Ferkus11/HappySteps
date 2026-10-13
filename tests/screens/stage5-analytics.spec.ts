import { test, type Page } from "@playwright/test";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

test.describe.configure({ mode: "serial" });

const S = "stage5";
const origin = (page: Page) => new URL(page.url()).origin;

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.locator('[data-testid^="section-"], [data-testid="analytics-empty"], [data-testid="analytics-future"]').first().waitFor();
  // charts measure their container after mount
  await page.waitForTimeout(300);
}

test("analytics · owner, all four sections (ru)", async ({ page }) => {
  await login(page, PHONES.owner);
  for (const tab of ["attendance", "staff", "finance", "funnel"]) {
    await open(page, `/analytics?tab=${tab}`);
    await snap(page, S, `analytics-owner-${tab}`);
  }
  await open(page, "/analytics?tab=attendance&p=quarter");
  await snap(page, S, "analytics-owner-attendance-quarter");
  await open(page, "/analytics?tab=funnel&p=custom&from=2026-08-01&to=2026-10-13");
  await snap(page, S, "analytics-owner-funnel-custom");
  await open(page, "/analytics?tab=attendance&p=year&d=2030-01-01");
  await snap(page, S, "analytics-owner-future");
});

test("analytics · owner in Kazakh", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: origin(page) }]);
  for (const tab of ["attendance", "staff", "finance", "funnel"]) {
    await open(page, `/analytics?tab=${tab}`);
    await snap(page, S, `analytics-owner-kk-${tab}`);
  }
});

test("analytics · head and accountant", async ({ page }) => {
  await login(page, PHONES.head);
  await open(page, "/analytics");
  await snap(page, S, "analytics-head-attendance");
  await login(page, PHONES.accountant);
  await open(page, "/analytics");
  await snap(page, S, "analytics-accountant-finance");
});

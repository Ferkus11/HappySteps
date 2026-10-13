import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const S = "stage2";

/** Waits until the streamed page is complete (no loading skeleton left). */
async function settle(page: Page, testId: string) {
  await expect(page.getByTestId(testId).first()).toBeVisible();
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
}

async function teacherId() {
  const { data } = await svc.from("profiles").select("id").eq("phone", PHONES.teacher).single();
  return data!.id as string;
}

test("worktime · teacher", async ({ page }) => {
  await login(page, PHONES.teacher);
  await settle(page, "workday-card");
  await snap(page, S, "worktime-teacher-dashboard");
  await page.goto("/worktime");
  await settle(page, "workday-card");
  await snap(page, S, "worktime-teacher-page");
});

test("worktime · head", async ({ page }) => {
  const teacher = await teacherId();
  await login(page, PHONES.head);
  await settle(page, "tile-late");
  await snap(page, S, "worktime-head-dashboard");
  await page.goto("/worktime");
  await settle(page, "worktime-list");
  await snap(page, S, "worktime-head-today");
  await page.goto(`/worktime/people/${teacher}`);
  await settle(page, "person-days");
  await snap(page, S, "worktime-head-person");
  await page.getByTestId("edit-session").first().click();
  await snap(page, S, "worktime-head-edit-dialog");
  await page.goto("/worktime/timesheet");
  await settle(page, "timesheet");
  await snap(page, S, "worktime-head-timesheet");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: new URL(page.url()).origin }]);
  await page.goto("/worktime");
  await settle(page, "worktime-list");
  await snap(page, S, "worktime-head-today-kk");
  await page.goto("/worktime/timesheet");
  await settle(page, "timesheet");
  await snap(page, S, "worktime-head-timesheet-kk");
  await page.context().clearCookies();
});

test("worktime · accountant and owner", async ({ page }) => {
  await login(page, PHONES.accountant);
  await settle(page, "timesheet-widget");
  await snap(page, S, "worktime-accountant-dashboard");
  await page.goto("/worktime/timesheet");
  await settle(page, "timesheet");
  await snap(page, S, "worktime-accountant-timesheet");
  await login(page, PHONES.owner);
  await settle(page, "tile-late");
  await snap(page, S, "worktime-owner-dashboard");
});

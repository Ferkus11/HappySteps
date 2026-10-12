import { test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { snap } from "./helpers";
import { PHONES, fillPhone, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage4";
const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
let contactedId = "";
let acceptedId = "";

test.beforeAll(async () => {
  await db.query("delete from waitlist_applications where child_name like 'Скринов %'");
  await db.query("delete from waitlist_rate_limits");
  contactedId = (await db.query("select id from waitlist_applications where child_name = 'Ким Алиса Дмитриевна'")).rows[0].id;
  acceptedId = (await db.query("select id from waitlist_applications where status = 'accepted' and child_name = 'Ахметов Алихан Даниярович'")).rows[0].id;
});
test.afterAll(async () => {
  await db.query("delete from waitlist_applications where child_name like 'Скринов %'");
  await db.query("delete from notifications where type = 'waitlist.new'");
  await db.query("delete from waitlist_rate_limits");
  await db.end();
});

const origin = (page: Page) => new URL(page.url()).origin;

test("waitlist · public form (ru, thank you, kk, not found)", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/apply/e2e-a");
  await snap(page, S, "waitlist-public-form");

  await page.getByTestId("apply-submit").click();
  await page.getByRole("alert").first().waitFor();
  await snap(page, S, "waitlist-public-errors");

  await page.goto("/apply/e2e-a");
  await page.getByTestId("wl-child-name").fill("Скринов Арсен Маратович");
  await page.getByTestId("wl-child-birth").fill("2022-06-10");
  await page.getByTestId("wl-parent-name").fill("Скринова Айжан Ериковна");
  await fillPhone(page, /Телефон родителя/, "+77059998877");
  await page.getByTestId("apply-submit").click();
  await page.getByTestId("apply-thanks").waitFor();
  await snap(page, S, "waitlist-public-thanks");

  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: origin(page) }]);
  await page.goto("/apply/e2e-a");
  await snap(page, S, "waitlist-public-kk");
  await page.context().clearCookies();

  await page.goto("/apply/no-such-garden");
  await page.getByTestId("apply-not-found").waitFor();
  await snap(page, S, "waitlist-public-404");
});

test("waitlist · head", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/waitlist");
  await page.getByTestId("wl-row").first().waitFor();
  await snap(page, S, "waitlist-head-list");

  await page.getByTestId("form-link-open").click();
  await page.getByTestId("form-qr").waitFor();
  await snap(page, S, "waitlist-head-qr");
  await page.keyboard.press("Escape");

  await page.getByTestId("wl-add").click();
  await page.getByRole("dialog").waitFor();
  await snap(page, S, "waitlist-head-add");
  await page.keyboard.press("Escape");

  await page.goto(`/waitlist/${contactedId}`);
  await page.getByTestId("wl-title").waitFor();
  await snap(page, S, "waitlist-head-card");

  await page.getByTestId("wl-accept").click();
  await page.getByTestId("wl-accept-group").waitFor();
  await snap(page, S, "waitlist-head-accept");
  await page.keyboard.press("Escape");

  await page.goto(`/waitlist/${acceptedId}`);
  await page.getByTestId("wl-accepted-card").waitFor();
  await snap(page, S, "waitlist-head-accepted");

  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: origin(page) }]);
  await page.goto(`/waitlist/${contactedId}`);
  await page.getByTestId("wl-title").waitFor();
  await snap(page, S, "waitlist-head-card-kk");
  await page.context().addCookies([{ name: "hs_locale", value: "ru", url: origin(page) }]);
});

test("waitlist · owner dashboard and settings", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.getByTestId("waitlist-widget").waitFor();
  await snap(page, S, "waitlist-owner-dashboard");
  await page.goto("/settings");
  await page.getByTestId("waitlist-settings").scrollIntoViewIfNeeded();
  await snap(page, S, "waitlist-owner-settings");
});

test("waitlist · accountant (read only)", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto("/waitlist?tab=all");
  await page.getByTestId("wl-row").first().waitFor();
  await snap(page, S, "waitlist-accountant-list");
  await page.goto(`/waitlist/${contactedId}`);
  await page.getByTestId("wl-title").waitFor();
  await snap(page, S, "waitlist-accountant-card");
});

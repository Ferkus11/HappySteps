import { test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage2";
let annPath = "";

/** A friendly picture drawn on a canvas (a real photo would be user content). */
async function samplePhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 640;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 960, 640);
    grad.addColorStop(0, "#EAF5FD");
    grad.addColorStop(1, "#FDE9EF");
    g.fillStyle = grad;
    g.fillRect(0, 0, 960, 640);
    const colors = ["#E8A33D", "#C02A62", "#4FA3E0", "#2E9E7A", "#7C6CD6"];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = colors[i % colors.length];
      g.beginPath();
      g.arc(80 + ((i * 137) % 820), 120 + ((i * 89) % 420), 30 + (i % 4) * 14, 0, Math.PI * 2);
      g.fill();
    }
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test.beforeAll(async () => {
  const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
  await db.query("delete from announcements where title like 'E2E %'");
  await db.end();
});
test.afterAll(async () => {
  const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
  await db.query("delete from notifications where url like '/announcements/%'");
  await db.end();
});

test("announcements · head", async ({ page }) => {
  await login(page, PHONES.head);
  const photo = await samplePhoto(page);
  await page.goto("/announcements");
  await page.getByTestId("new-announcement").click();
  await page.getByTestId("announcement-title").fill("E2E Осенняя ярмарка в пятницу");
  await page
    .getByTestId("announcement-body")
    .fill("Дорогие родители! В пятницу с 16:00 во дворе сада — осенняя ярмарка. Приносите поделки и выпечку, все средства пойдут на новые игрушки для групп.");
  await page.locator("label", { has: page.getByTestId("audience-groups") }).click();
  await page.getByTestId("group-option-Солнышко").check();
  await page.getByTestId("announcement-important").click();
  await snap(page, S, "announcements-head-new");
  await page.getByTestId("announcement-photos").setInputFiles([
    { name: "yarmarka-1.png", mimeType: "image/png", buffer: photo },
    { name: "yarmarka-2.png", mimeType: "image/png", buffer: photo },
    { name: "yarmarka-3.png", mimeType: "image/png", buffer: photo },
  ]);
  await page.getByTestId("announcement-pdfs").setInputFiles({ name: "Программа ярмарки.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.getByTestId("announcement-submit").click();
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  annPath = new URL(page.url()).pathname;
  await page.getByTestId("announcement-gallery").locator("img").first().waitFor();
  await snap(page, S, "announcements-head-detail");
  await page.goto("/announcements");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await snap(page, S, "announcements-head-list");
});

test("announcements · parent and teacher", async ({ page }) => {
  await login(page, PHONES.parent);
  await snap(page, S, "announcements-parent-dashboard");
  await page.goto("/announcements");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await snap(page, S, "announcements-parent-list");
  await page.goto(annPath);
  await page.getByTestId("announcement-gallery").locator("img").first().waitFor();
  await snap(page, S, "announcements-parent-detail");
  await page.getByTestId("announcement-gallery").locator("button").first().click();
  await snap(page, S, "announcements-parent-photo");
  await login(page, PHONES.teacher);
  await page.goto("/announcements");
  await page.getByTestId("new-announcement").click();
  await snap(page, S, "announcements-teacher-new");
  await login(page, PHONES.parentB);
  await page.goto("/announcements");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await snap(page, S, "announcements-parentB-empty");
});

test("events · calendar per role", async ({ page }) => {
  await login(page, PHONES.head);
  await snap(page, S, "events-head-dashboard");
  await page.goto("/events");
  await page.getByTestId("calendar-grid").waitFor();
  await snap(page, S, "events-head-calendar");
  await page.getByTestId("new-event").click();
  await snap(page, S, "events-head-new");
  await page.keyboard.press("Escape");
  await page.getByTestId("upcoming-list").getByTestId("event-row").first().click();
  await snap(page, S, "events-head-details");
  await login(page, PHONES.teacher);
  await snap(page, S, "events-teacher-dashboard");
  await page.goto("/events");
  await page.getByTestId("calendar-grid").waitFor();
  await snap(page, S, "events-teacher-calendar");
  await login(page, PHONES.parent);
  await page.goto("/events");
  await page.getByTestId("calendar-grid").waitFor();
  await snap(page, S, "events-parent-calendar");
  await login(page, PHONES.cook);
  await page.goto("/events");
  await page.getByTestId("calendar-grid").waitFor();
  await snap(page, S, "events-cook-calendar");
  await login(page, PHONES.head);
  const port = process.env.E2E_PORT ?? "3100";
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: `http://localhost:${port}` }]);
  await page.goto("/events");
  await page.getByTestId("calendar-grid").waitFor();
  await snap(page, S, "events-head-calendar-kk");
  await page.goto(annPath);
  await page.getByTestId("announcement-heading").waitFor();
  await snap(page, S, "announcements-head-detail-kk");
  await page.context().addCookies([{ name: "hs_locale", value: "ru", url: `http://localhost:${port}` }]);
});

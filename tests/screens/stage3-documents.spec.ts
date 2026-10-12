import { test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage3";
let alikhan = "";
let teacherId = "";

/** A sheet-of-paper-like picture drawn on a canvas (stands in for a phone photo of a certificate). */
async function samplePhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 960;
    const g = c.getContext("2d")!;
    g.fillStyle = "#EAF5FD";
    g.fillRect(0, 0, 720, 960);
    g.fillStyle = "#FFFFFF";
    g.fillRect(60, 60, 600, 840);
    g.fillStyle = "#1F2937";
    g.font = "bold 36px sans-serif";
    g.fillText("СПРАВКА", 260, 160);
    g.fillStyle = "#9CA3AF";
    for (let i = 0; i < 16; i++) g.fillRect(110, 220 + i * 38, 400 + ((i * 53) % 100), 10);
    g.strokeStyle = "#4FA3E0";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(520, 780, 70, 0, Math.PI * 2);
    g.stroke();
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test.beforeAll(async () => {
  const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
  await db.query("delete from child_documents where title like 'E2E %'");
  alikhan = (await db.query("select id from children where full_name = 'Ахметов Алихан Даниярович'")).rows[0].id;
  teacherId = (await db.query("select id from profiles where phone = $1", [PHONES.teacher])).rows[0].id;
  await db.end();
});
test.afterAll(async () => {
  const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
  await db.query("delete from child_documents where title like 'E2E %'");
  await db.end();
});

test("documents · parent", async ({ page }) => {
  await login(page, PHONES.parent);
  const photo = await samplePhoto(page);
  await page.goto("/documents");
  const folder = page.getByTestId(`child-folder-${alikhan}`);
  await folder.getByTestId("doc-tab-medical").click();
  await folder.getByTestId("doc-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("doc-file").setInputFiles({ name: "spravka.png", mimeType: "image/png", buffer: photo });
  await dialog.getByTestId("doc-title").fill("Справка 095/у");
  await snap(page, S, "documents-parent-upload");
  await dialog.getByTestId("doc-title").fill("E2E Справка 095/у");
  await dialog.getByTestId("doc-upload-submit").click();
  await dialog.waitFor({ state: "hidden" });
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "hidden", timeout: 15_000 });
  await folder.getByTestId("doc-panel-medical").getByTestId("doc-row").first().waitFor();
  await snap(page, S, "documents-parent-folder");
  await folder.getByTestId("doc-panel-medical").getByTestId("doc-open").first().click();
  await page.getByTestId("doc-lightbox-img").waitFor();
  await page.waitForFunction(() => (document.querySelector('[data-testid="doc-lightbox-img"]') as HTMLImageElement | null)?.naturalWidth);
  await snap(page, S, "documents-parent-lightbox");
  await page.keyboard.press("Escape");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: new URL(page.url()).origin }]);
  await page.goto("/documents");
  await page.getByTestId(`child-folder-${alikhan}`).waitFor();
  await snap(page, S, "documents-parent-folder-kk");
  await page.context().addCookies([{ name: "hs_locale", value: "ru", url: new URL(page.url()).origin }]);
});

test("documents · teacher", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/documents");
  await page.getByTestId("group-children").waitFor();
  await page.getByTestId("my-documents").waitFor();
  await snap(page, S, "documents-teacher-overview");
  await page.goto(`/documents/child/${alikhan}?category=medical`);
  await page.getByTestId(`child-folder-${alikhan}`).waitFor();
  await snap(page, S, "documents-teacher-child-folder");
  await page.goto("/");
  await page.getByTestId("my-expiring-documents").waitFor();
  await snap(page, S, "documents-teacher-dashboard");
});

test("documents · head", async ({ page }) => {
  await login(page, PHONES.head);
  await page.getByTestId("expiring-documents").waitFor();
  await snap(page, S, "documents-head-dashboard");
  await page.goto("/documents");
  await page.getByTestId("doc-search").waitFor();
  await snap(page, S, "documents-head-children");
  await page.goto("/documents?tab=staff");
  await page.getByTestId("staff-documents").waitFor();
  await snap(page, S, "documents-head-staff");
  await page.goto("/documents?tab=staff&filter=expiring");
  await page.getByTestId("staff-documents").waitFor();
  await snap(page, S, "documents-head-expiring");
  await page.goto(`/children/${alikhan}`);
  await page.getByTestId("child-documents-card").waitFor();
  await snap(page, S, "documents-head-child-card");
  await page.goto(`/staff/${teacherId}`);
  await page.getByTestId("staff-documents-card").waitFor();
  await snap(page, S, "documents-head-staff-card");
  await page.goto(`/documents/staff/${teacherId}`);
  await page.getByTestId(`staff-folder-${teacherId}`).waitFor();
  await snap(page, S, "documents-head-staff-folder");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: new URL(page.url()).origin }]);
  await page.goto("/documents?tab=staff");
  await page.getByTestId("staff-documents").waitFor();
  await snap(page, S, "documents-head-staff-kk");
  await page.context().addCookies([{ name: "hs_locale", value: "ru", url: new URL(page.url()).origin }]);
});

test("documents · accountant & cook", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto("/documents");
  await page.getByTestId("staff-documents").waitFor();
  await snap(page, S, "documents-accountant-overview");
  await login(page, PHONES.cook);
  await page.goto("/documents");
  await page.getByTestId("my-documents").waitFor();
  await snap(page, S, "documents-cook-own");
});

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import ExcelJS from "exceljs";
import { PHONES, login } from "./helpers";
import { seedPayments } from "../../scripts/seed/e2e-payments";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const CUR = `${today.slice(0, 7)}-01`;
const money = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;

let A = "";

test.beforeAll(async () => {
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  const users: Record<string, string> = {};
  for (const [k, phone] of Object.entries(PHONES)) {
    const p = (await db.from("profiles").select("id").eq("phone", phone).maybeSingle()).data;
    if (p) users[k] = p.id;
  }
  // Re-runnable: rebuild garden A's invoices — Сабина owes the previous and the current month (2 × 60 000).
  await seedPayments(db, { users, kindergartens: { A } });
});

async function openSection(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('[data-testid^="section-"], [data-testid="analytics-empty"]').first()).toBeVisible();
}

test("owner sees all four sections with insights, period picker works", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.goto("/analytics");
  for (const tab of ["attendance", "staff", "finance", "funnel"]) await expect(page.getByTestId(`analytics-tab-${tab}`)).toBeVisible();
  // attendance has fixture history (last two months)
  await expect(page.getByTestId("section-attendance")).toBeVisible();
  await expect(page.getByTestId("chart-daily-insight")).toContainText(/Посещаемость .* — \d+%/);
  await expect(page.getByTestId("kpi-attendance-value")).toHaveText(/\d+%/);

  await page.getByTestId("analytics-tab-staff").click();
  await expect(page).toHaveURL(/tab=staff/);
  await expect(page.locator('[data-testid="section-staff"], [data-testid="analytics-empty"]').first()).toBeVisible();

  await page.getByTestId("analytics-tab-funnel").click();
  await expect(page.locator('[data-testid="section-funnel"], [data-testid="analytics-empty"]').first()).toBeVisible();

  await page.getByTestId("analytics-tab-finance").click();
  await expect(page.getByTestId("section-finance")).toBeVisible();

  // period picker: quarter, previous quarter, custom range
  await page.getByTestId("period-quarter").click();
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  await expect(page.getByTestId("period-label")).toHaveText(`${q} квартал ${today.slice(0, 4)}`);
  await page.getByTestId("period-prev").click();
  await expect(page.getByTestId("period-label")).toHaveText(q === 1 ? `4 квартал ${Number(today.slice(0, 4)) - 1}` : `${q - 1} квартал ${today.slice(0, 4)}`);
  await page.getByTestId("period-custom").click();
  await page.getByTestId("custom-from").fill(CUR);
  await page.getByTestId("custom-to").fill(today);
  await page.getByTestId("custom-apply").click();
  await expect(page).toHaveURL(new RegExp(`p=custom&from=${CUR}&to=${today}`));
  await expect(page.getByTestId("section-finance")).toBeVisible();
});

test("finance numbers match the invoices: debt of the month and the debtors total", async ({ page }) => {
  const { data: cur } = await db.from("invoices").select("balance").eq("kindergarten_id", A).eq("period", CUR);
  const monthDebt = (cur ?? []).reduce((s, r) => s + Number(r.balance), 0);
  const { data: open } = await db.from("invoices").select("balance").eq("kindergarten_id", A).gt("balance", 0);
  const allDebt = (open ?? []).reduce((s, r) => s + Number(r.balance), 0);
  expect(monthDebt).toBeGreaterThan(0);

  await login(page, PHONES.accountant);
  await openSection(page, "/analytics?tab=finance&p=month");
  await expect(page.getByTestId("kpi-debt-value")).toHaveText(money(monthDebt));
  const debtors = page.getByTestId("table-debtors");
  await expect(debtors.locator("tr", { hasText: "Бекова Сабина" })).toContainText(money(120000));
  await expect(page.getByTestId("table-debtors-total").locator('[data-col="debt"]')).toHaveText(money(allDebt));
  await expect(page.getByTestId("chart-debtors-insight")).toContainText(money(allDebt));
});

test("xlsx export of a table (download) with the same numbers", async ({ page }) => {
  await login(page, PHONES.owner);
  await openSection(page, "/analytics?tab=finance");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("chart-debtors-export").click()]);
  expect(download.suggestedFilename()).toMatch(/^analytics-finance-debtors-.*\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await import("node:fs")).readFileSync(await download.path()) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  expect(rows[0][0]).toContain("Аналитика");
  const header = rows.find((r) => r[0] === "Ребёнок")!;
  expect(header).toEqual(["Ребёнок", "Группа", "Долг", "Долг с", "Просрочка, дн.", "Месяцев"]);
  const sabina = rows.find((r) => String(r[0]).startsWith("Бекова Сабина"))!;
  expect(sabina[2]).toBe(120000);

  const att = await page.request.get("/analytics/export?section=attendance&table=groups&p=month");
  expect(att.status()).toBe(200);
  expect(att.headers()["content-type"]).toContain("spreadsheetml");
});

test("head: everything except finances (tab hidden, URL falls back, export 403)", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/analytics");
  await expect(page.getByTestId("analytics-tab-attendance")).toBeVisible();
  await expect(page.getByTestId("analytics-tab-staff")).toBeVisible();
  await expect(page.getByTestId("analytics-tab-funnel")).toBeVisible();
  await expect(page.getByTestId("analytics-tab-finance")).toHaveCount(0);
  await openSection(page, "/analytics?tab=finance");
  await expect(page.getByTestId("section-finance")).toHaveCount(0);
  await expect(page.getByTestId("section-attendance")).toBeVisible();
  expect((await page.request.get("/analytics/export?section=finance&table=debtors")).status()).toBe(403);
  expect((await page.request.get("/analytics/export?section=staff&table=staff")).status()).toBe(200);
});

test("accountant: finances only", async ({ page }) => {
  await login(page, PHONES.accountant);
  await openSection(page, "/analytics?tab=attendance");
  await expect(page.getByTestId("section-finance")).toBeVisible();
  await expect(page.getByTestId("section-attendance")).toHaveCount(0);
  await expect(page.locator('[data-testid^="analytics-tab-"]')).toHaveCount(0);
  for (const s of ["attendance", "staff", "funnel"]) expect((await page.request.get(`/analytics/export?section=${s}`)).status(), s).toBe(403);
  expect((await page.request.get("/analytics/export?section=finance&table=months")).status()).toBe(200);
});

test("teacher and parent are redirected; their exports are refused", async ({ page }) => {
  for (const phone of [PHONES.teacher, PHONES.parent]) {
    await login(page, phone);
    await page.goto("/analytics");
    await expect(page).toHaveURL(/\/$/);
    expect((await page.request.get("/analytics/export?section=attendance")).status()).toBe(403);
    expect((await page.request.get("/analytics/export?section=finance")).status()).toBe(403);
  }
  // signed out: the proxy sends the request to the login page — never a spreadsheet
  await page.context().clearCookies();
  const anon = await page.request.get("/analytics/export?section=finance", { maxRedirects: 0 });
  expect([302, 303, 307, 403]).toContain(anon.status());
  expect(anon.headers()["content-type"] ?? "").not.toContain("spreadsheetml");
});

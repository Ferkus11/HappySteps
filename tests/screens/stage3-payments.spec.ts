import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";
import { seedPayments } from "../../scripts/seed/e2e-payments";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage3";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let A = "";

test.beforeAll(async () => {
  // Deterministic state: previous + current month, one paid, one partial, one pending receipt, one debtor.
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  const users: Record<string, string> = {};
  for (const [k, phone] of Object.entries(PHONES)) {
    const p = (await db.from("profiles").select("id").eq("phone", phone).maybeSingle()).data;
    if (p) users[k] = p.id;
  }
  await seedPayments(db, { users, kindergartens: { A } });
});

async function childId(first: string) {
  return (await db.from("children").select("id").eq("kindergarten_id", A).ilike("full_name", `%${first}%`).single()).data!.id as string;
}

async function setLocale(page: Page, locale: "ru" | "kk") {
  const url = new URL(page.url());
  await page.context().addCookies([{ name: "hs_locale", value: locale, url: url.origin }]);
}

test("payments · parent", async ({ page }) => {
  await login(page, PHONES.parent);
  await expect(page.getByTestId("parent-payment")).toBeVisible();
  await snap(page, S, "payments-parent-dashboard");
  await page.goto("/payments");
  await expect(page.getByTestId("requisites")).toBeVisible();
  await snap(page, S, "payments-parent-main");
  await setLocale(page, "kk");
  await page.goto("/payments");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Төлем");
  await snap(page, S, "payments-parent-main-kk");
  await setLocale(page, "ru");
});

test("payments · accountant", async ({ page }) => {
  await login(page, PHONES.accountant);
  await expect(page.getByTestId("receipts-pending")).toBeVisible();
  await snap(page, S, "payments-accountant-dashboard");
  await page.goto("/payments");
  await expect(page.getByTestId("receipt-item").first()).toBeVisible();
  await snap(page, S, "payments-accountant-queue");
  await page.getByTestId("receipt-item").first().getByTestId("open-receipt").click();
  await expect(page.getByTestId("receipt-image")).toBeVisible();
  await page.waitForTimeout(300);
  await snap(page, S, "payments-accountant-review");
  await page.keyboard.press("Escape");
  await page.goto("/payments?tab=month");
  await expect(page.getByTestId("month-row").first()).toBeVisible();
  await snap(page, S, "payments-accountant-month");
  await page.goto("/payments?tab=debtors");
  await expect(page.getByTestId("debtor-row").first()).toBeVisible();
  await snap(page, S, "payments-accountant-debtors");
  const aylin = await childId("Айлин");
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit" }).format(new Date());
  const inv = (await db.from("invoices").select("id").eq("child_id", aylin).eq("period", `${month}-01`).single()).data!.id;
  await page.goto(`/payments/${inv}`);
  await expect(page.getByTestId("invoice-card")).toBeVisible();
  await snap(page, S, "payments-accountant-invoice");
  await page.getByTestId("adjust-invoice").click();
  await snap(page, S, "payments-accountant-adjust");
  await page.keyboard.press("Escape");
  await page.goto(`/children/${await childId("Алихан")}`);
  await expect(page.getByTestId("child-payment")).toBeVisible();
  await snap(page, S, "payments-accountant-child");
});

test("payments · owner and head", async ({ page }) => {
  await login(page, PHONES.owner);
  await expect(page.getByTestId("dash-payments")).toBeVisible();
  await snap(page, S, "payments-owner-dashboard");
  await login(page, PHONES.head);
  await page.goto("/payments");
  await page.getByTestId("receipt-item").first().getByTestId("open-receipt").click();
  await expect(page.getByTestId("view-only")).toBeVisible();
  await expect(page.getByTestId("receipt-image")).toBeVisible();
  await snap(page, S, "payments-head-review");
});

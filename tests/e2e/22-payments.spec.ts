import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PHONES, expectToast, login } from "./helpers";
import { RECEIPT_SAMPLE, clearPayments } from "../../scripts/seed/e2e-payments";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const month = (delta: number) => {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
};
const PREV = month(-1);
const CUR = month(0);
const RECEIPT = { name: "receipt.png", mimeType: "image/png", buffer: RECEIPT_SAMPLE() };
const REASON = "На чеке не видна сумма перевода";

let A = "";
const kids: Record<string, string> = {};
const users: Record<string, string> = {};

const invoice = async (child: string, period: string) =>
  (await db.from("invoices").select("*").eq("child_id", kids[child]).eq("period", period).single()).data as {
    id: string;
    status: string;
    balance: string;
    carried: string;
    amount: string;
  };

/** A receipt exactly as the upload action stores it (file in storage + row written by the server). */
async function serverReceipt(child: string, period: string, uploadedBy: string | null = null) {
  const inv = await invoice(child, period);
  const path = `${A}/${kids[child]}/${crypto.randomUUID()}.png`;
  await db.storage.from("receipts").upload(path, RECEIPT.buffer, { contentType: "image/png" });
  const { data, error } = await db
    .from("payment_receipts")
    .insert({ kindergarten_id: A, invoice_id: inv.id, child_id: kids[child], uploaded_by: uploadedBy, file_path: path, mime: "image/png", size: RECEIPT.buffer.length })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function ownerDebt(page: Page) {
  await login(page, PHONES.owner);
  const el = page.getByTestId("dash-payments");
  await expect(el).toBeVisible();
  return Number(await el.getAttribute("data-debt"));
}

test.beforeAll(async () => {
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  for (const c of (await db.from("children").select("id, full_name").eq("kindergarten_id", A)).data!) kids[c.full_name.split(" ")[1]] = c.id;
  for (const [k, phone] of Object.entries(PHONES)) {
    const p = (await db.from("profiles").select("id").eq("phone", phone).maybeSingle()).data;
    if (p) users[k] = p.id;
  }
  // Re-runnable: rebuild garden A's payments — previous month accrued, Алихан and Миша paid it.
  await clearPayments(db, A);
  await db.from("notifications").delete().eq("kindergarten_id", A).like("type", "receipt.%");
  await db.rpc("invoices_accrue", { p_kg: A, p_period: PREV });
  for (const child of ["Алихан", "Миша"]) {
    const id = await serverReceipt(child, PREV);
    await db.from("payment_receipts").update({ status: "accepted", confirmed_amount: 65000, reviewed_at: new Date().toISOString(), reviewed_by: users.accountant }).eq("id", id);
  }
});

test.afterAll(async () => {
  await db.from("notifications").delete().eq("kindergarten_id", A).like("type", "receipt.%");
});

test("accountant accrues the current month; a second click creates nothing (idempotent)", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto(`/payments?tab=month&month=${CUR.slice(0, 7)}`);
  await expect(page.getByText("За этот месяц счетов нет")).toBeVisible();
  await page.getByTestId("accrue-month").click();
  await expectToast(page, /Создано? \d+ сч/);
  await expect(page.getByTestId("month-row").filter({ hasText: "Ахметов Алихан" })).toBeVisible();
  const { count } = await db.from("invoices").select("id", { count: "exact", head: true }).eq("kindergarten_id", A).eq("period", CUR);
  expect(count).toBeGreaterThanOrEqual(4);
  await page.getByTestId("accrue-month").click();
  await expectToast(page, "Новых счетов нет — все уже начислены");
  const again = await db.from("invoices").select("id", { count: "exact", head: true }).eq("kindergarten_id", A).eq("period", CUR);
  expect(again.count).toBe(count);
  // totals: 4 fee-paying children; Алихан and Миша have nothing carried
  await expect(page.getByTestId("month-row").filter({ hasText: "Касымова Айлин" })).toContainText("120 000 ₸"); // 60 000 carried + 60 000
});

test("scenario 5: receipt → rejected with a reason → parent notified, uploads again → confirmed → paid, debt gone", async ({ page, browser }) => {
  const debtBefore = await ownerDebt(page);
  expect(debtBefore).toBeGreaterThan(0);

  // Parent: amount, requisites with copy buttons, upload a receipt.
  await login(page, PHONES.parent);
  await page.goto("/payments");
  const card = page.getByTestId("current-invoice").filter({ has: page.getByTestId("parent-to-pay") }).first();
  await expect(card.getByTestId("parent-to-pay")).toHaveText("65 000 ₸");
  await expect(page.getByTestId("requisite-kaspi")).toHaveText("+7 701 000 00 00");
  await expect(page.getByTestId("requisite-purpose")).toContainText("Ахметов Алихан Даниярович");
  await expect(page.getByTestId("copy-iban")).toBeVisible();
  await expect(page.getByTestId("upload-receipt").first()).toHaveAttribute("data-ready", "true");
  await page.getByTestId("receipt-file").setInputFiles(RECEIPT);
  await expectToast(page, "Чек отправлен на проверку");
  await expect(card.getByTestId("invoice-status")).toHaveAttribute("data-status", "review");
  const toAccountant = await db.from("notifications").select("id").eq("type", "receipt.new").eq("user_id", users.accountant);
  expect(toAccountant.data!.length).toBeGreaterThan(0);

  // Accountant rejects with a reason.
  await login(page, PHONES.accountant);
  await page.goto("/payments");
  const item = page.getByTestId("receipt-item").filter({ hasText: "Ахметов Алихан" });
  await item.getByTestId("open-receipt").click();
  await expect(page.getByTestId("receipt-image")).toBeVisible();
  await page.getByTestId("receipt-reject").click();
  await page.getByTestId("reject-submit").click();
  await expect(page.getByText("Укажите причину отклонения.").first()).toBeVisible();
  await page.getByTestId("reject-reason").fill(REASON);
  await page.getByTestId("reject-submit").click();
  await expectToast(page, "Чек отклонён, родитель получит уведомление");
  await expect(page.getByTestId("receipt-item").filter({ hasText: "Ахметов Алихан" })).toHaveCount(0);
  const audit = await db.from("audit_log").select("details").eq("action", "receipt.reject").eq("kindergarten_id", A).order("id", { ascending: false }).limit(1);
  expect(audit.data![0].details).toMatchObject({ reason: REASON });

  // Parent is notified, sees the reason and uploads again.
  const notes = await db.from("notifications").select("params").eq("type", "receipt.rejected").eq("user_id", users.parent);
  expect(notes.data!.map((n) => n.params.reason)).toContain(REASON);
  await login(page, PHONES.parent);
  await page.goto("/payments");
  await expect(page.getByTestId("rejected-reason")).toContainText(REASON);
  await expect(page.getByTestId("upload-receipt").first()).toHaveText(/Загрузить чек заново/);
  await expect(page.getByTestId("upload-receipt").first()).toHaveAttribute("data-ready", "true");
  await page.getByTestId("receipt-file").setInputFiles(RECEIPT);
  await expectToast(page, "Чек отправлен на проверку");
  await expect(page.getByTestId("current-invoice").first().getByTestId("invoice-status")).toHaveAttribute("data-status", "review");

  // Accountant confirms the full amount (prefilled with what is due).
  await login(page, PHONES.accountant);
  await page.goto("/payments");
  await page.getByTestId("receipt-item").filter({ hasText: "Ахметов Алихан" }).getByTestId("open-receipt").click();
  await expect(page.getByTestId("confirmed-amount")).toHaveValue("65000");
  await page.getByTestId("receipt-confirm").click();
  await expectToast(page, "Оплата подтверждена");
  expect((await invoice("Алихан", CUR)).status).toBe("paid");
  const accepted = await db.from("notifications").select("id").eq("type", "receipt.accepted").eq("user_id", users.parent);
  expect(accepted.data!.length).toBe(1);
  await page.goto("/payments?tab=debtors");
  await expect(page.getByTestId("debtor-row").first()).toBeVisible();
  await expect(page.getByTestId("debtor-row").filter({ hasText: "Ахметов Алихан" })).toHaveCount(0);

  // Parent sees «Оплачен»; the owner's debt sum dropped by the confirmed amount.
  await login(page, PHONES.parent);
  await page.goto("/payments");
  await expect(page.getByTestId("current-invoice").first().getByTestId("invoice-status")).toHaveAttribute("data-status", "paid");
  await expect(page.getByTestId("parent-to-pay").first()).toHaveText("0 ₸");
  const after = await ownerDebt(page);
  expect(after).toBe(debtBefore - 65000);

  // Accountant's dashboard no longer lists the receipt.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await login(p2, PHONES.accountant);
  await expect(p2.getByTestId("receipts-pending")).toHaveAttribute("data-count", "0");
  await ctx.close();
});

test("accountant adjusts an amount: the comment is required and the change is audited", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto(`/payments?tab=month&month=${CUR.slice(0, 7)}`);
  await page.getByTestId("month-row").filter({ hasText: "Смирнов Миша" }).click();
  await expect(page.getByTestId("invoice-title")).toContainText("Счёт за");
  await page.getByTestId("adjust-invoice").click();
  await page.getByTestId("adjust-amount").fill("50000");
  await page.getByTestId("adjust-submit").click();
  await expect(page.getByText("Укажите комментарий: почему меняется сумма.").first()).toBeVisible();
  expect(Number((await invoice("Миша", CUR)).amount)).toBe(65000);
  await page.getByTestId("adjust-comment").fill("Скидка: второй ребёнок в саду");
  await page.getByTestId("adjust-submit").click();
  await expectToast(page, "Сумма изменена");
  await expect(page.getByTestId("invoice-amount")).toHaveText("50 000 ₸");
  await expect(page.getByTestId("invoice-adjusted")).toContainText("Скидка: второй ребёнок в саду");
  const inv = await invoice("Миша", CUR);
  const a = await db.from("audit_log").select("details, actor_id").eq("action", "invoice.adjust").eq("entity_id", inv.id).single();
  expect(a.data!.actor_id).toBe(users.accountant);
  expect(a.data!.details).toMatchObject({ comment: "Скидка: второй ребёнок в саду", to: 50000 });
});

test("partial payment leaves «Частично» and carries the rest; an overpayment becomes next month's advance", async ({ page }) => {
  await serverReceipt("Сабина", PREV);
  await serverReceipt("Айлин", PREV);
  await login(page, PHONES.accountant);
  await page.goto("/payments");
  for (const [name, amount] of [
    ["Бекова Сабина", "40000"],
    ["Касымова Айлин", "70000"],
  ]) {
    await page.getByTestId("receipt-item").filter({ hasText: name }).getByTestId("open-receipt").click();
    await page.getByTestId("confirmed-amount").fill(amount);
    await page.getByTestId("receipt-confirm").click();
    await expectToast(page, "Оплата подтверждена");
    await expect(page.getByTestId("receipt-item").filter({ hasText: name })).toHaveCount(0);
  }
  await page.goto(`/payments?tab=month&month=${PREV.slice(0, 7)}`);
  await expect(page.getByTestId("month-row").filter({ hasText: "Бекова Сабина" })).toHaveAttribute("data-status", "partial");
  await expect(page.getByTestId("month-row").filter({ hasText: "Касымова Айлин" })).toHaveAttribute("data-status", "paid");

  await page.goto(`/payments/${(await invoice("Сабина", CUR)).id}`);
  await expect(page.getByTestId("invoice-carried-debt")).toHaveText("+20 000 ₸");
  await expect(page.getByTestId("invoice-to-pay")).toHaveText("80 000 ₸");
  await page.goto(`/payments/${(await invoice("Айлин", CUR)).id}`);
  await expect(page.getByTestId("invoice-carried-advance")).toHaveText("−10 000 ₸");
  await expect(page.getByTestId("invoice-to-pay")).toHaveText("50 000 ₸");
});

test("head can view receipts but not confirm them; a forged confirm is rejected", async ({ page, browser }) => {
  const rid = await serverReceipt("Миша", CUR, users.teacherParent);
  await login(page, PHONES.head);
  await page.goto("/payments");
  const item = page.getByTestId("receipt-item").filter({ hasText: "Смирнов Миша" });
  await expect(item.getByTestId("open-receipt")).toHaveText("Открыть");
  await item.getByTestId("open-receipt").click();
  await expect(page.getByTestId("receipt-image")).toBeVisible();
  await expect(page.getByTestId("view-only")).toBeVisible();
  await expect(page.getByTestId("receipt-confirm")).toHaveCount(0);
  await expect(page.getByTestId("receipt-reject")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto(`/payments?tab=month&month=${CUR.slice(0, 7)}`);
  await expect(page.getByTestId("accrue-month")).toHaveCount(0);
  await page.getByTestId("month-row").filter({ hasText: "Смирнов Миша" }).click();
  await expect(page.getByTestId("adjust-invoice")).toHaveCount(0);

  // Forge: open the accountant's dialog, then send the confirm with the head's session.
  const headCookies = await page.context().cookies();
  const acc = await browser.newContext();
  const p2 = await acc.newPage();
  await login(p2, PHONES.accountant);
  await p2.goto("/payments");
  await p2.getByTestId("receipt-item").filter({ hasText: "Смирнов Миша" }).getByTestId("open-receipt").click();
  await expect(p2.getByTestId("confirmed-amount")).toBeVisible();
  await acc.clearCookies();
  await acc.addCookies(headCookies);
  await p2.getByTestId("receipt-confirm").click();
  await expectToast(p2, "Недостаточно прав для этого действия.");
  await acc.close();
  expect((await db.from("payment_receipts").select("status").eq("id", rid).single()).data!.status).toBe("pending");
});

test("parents see only their own children's invoices; other gardens and other roles see nothing", async ({ page }) => {
  const misha = await invoice("Миша", CUR);
  const alikhan = await invoice("Алихан", CUR);
  await login(page, PHONES.parent);
  await page.goto(`/payments/${misha.id}`);
  await expect(page.getByText(/could not be found|не найден/i).first()).toBeVisible();
  await expect(page.getByTestId("invoice-title")).toHaveCount(0);
  await expect(page.getByText("Смирнов Миша")).toHaveCount(0);
  await page.goto("/payments");
  await expect(page.getByTestId("parent-child-payments")).toHaveCount(1);
  await expect(page.getByText("Смирнов Миша")).toHaveCount(0);

  await login(page, PHONES.parentB);
  await page.goto("/payments");
  await expect(page.getByText("Ахметов Алихан")).toHaveCount(0);
  await page.goto(`/payments/${alikhan.id}`);
  await expect(page.getByText(/could not be found|не найден/i).first()).toBeVisible();
  await expect(page.getByTestId("invoice-title")).toHaveCount(0);

  await login(page, PHONES.teacher);
  await page.goto("/payments");
  await expect(page).toHaveURL(/\/$/);
});

test("xlsx export: 200 for the accountant, 403 for a teacher", async ({ page }) => {
  await login(page, PHONES.accountant);
  const ok = await page.request.get(`/payments/export?month=${CUR.slice(0, 7)}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toContain("spreadsheetml");
  expect((await ok.body()).subarray(0, 2).toString()).toBe("PK");
  await login(page, PHONES.teacher);
  const denied = await page.request.get(`/payments/export?month=${CUR.slice(0, 7)}`);
  expect(denied.status()).toBe(403);
});

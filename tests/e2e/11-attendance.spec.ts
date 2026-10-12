import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PHONES, login } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

let A = "";
let gA1 = "";
let gA2 = "";
let alikhan = "";
let restoreHoliday: { date: string; name: string; kind: string } | null | undefined;

async function cleanToday() {
  await db.from("child_attendance").delete().eq("kindergarten_id", A).eq("date", today);
  await db.from("absence_reports").delete().eq("kindergarten_id", A).gte("date_to", today);
}

test.beforeAll(async () => {
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  const groups = (await db.from("groups").select("id, name").eq("kindergarten_id", A)).data!;
  gA1 = groups.find((g) => g.name === "Солнышко")!.id;
  gA2 = groups.find((g) => g.name === "Звёздочки")!.id;
  alikhan = (await db.from("children").select("id").eq("kindergarten_id", A).ilike("full_name", "%Алихан%").single()).data!.id;
  // Independent of the weekday: make today a working day for the run.
  const { data: working } = await db.rpc("kg_is_working_day", { kg: A, d: today });
  if (!working) {
    const { data: existing } = await db.from("holidays").select("date, name, kind").eq("kindergarten_id", A).eq("date", today).maybeSingle();
    restoreHoliday = existing ?? null;
    await db.from("holidays").upsert({ kindergarten_id: A, date: today, name: "E2E рабочий день", kind: "working_day" }, { onConflict: "kindergarten_id,date" });
  }
  await cleanToday();
});

test.afterAll(async () => {
  await cleanToday();
  if (restoreHoliday === null) await db.from("holidays").delete().eq("kindergarten_id", A).eq("date", today);
  else if (restoreHoliday) await db.from("holidays").upsert({ kindergarten_id: A, ...restoreHoliday }, { onConflict: "kindergarten_id,date" });
});

const portions = (page: Page, group: string) => page.locator(`[data-testid="portions-group"][data-group="${group}"] [data-testid="portions-expected"]`);
const child = (page: Page, name: string) => page.locator(`[data-testid="attendance-child"][data-child*="${name}"]`);

test("scenario 3: parent reports «болеет» for 3 days → teacher sees the reason → cook has one portion less", async ({ page }) => {
  await login(page, PHONES.cook);
  await expect(page.getByTestId("portions-total")).toBeVisible();
  const before = Number(await portions(page, "Солнышко").innerText());
  const totalBefore = Number(await page.getByTestId("portions-total").innerText());

  await login(page, PHONES.parent);
  await page.getByTestId("report-absence").first().click();
  await page.getByTestId("absence-mode-period").click();
  await page.getByTestId("absence-from").fill(today);
  await page.getByTestId("absence-to").fill(addDays(today, 2));
  await page.getByTestId("absence-reason-sick").click();
  await page.getByLabel("Комментарий").fill("Температура");
  await page.getByTestId("absence-submit").click();
  await expect(page.getByTestId("absence-sick-hint")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("child-today-status")).toHaveText("Сегодня не в саду");
  await expect(page.getByTestId("absence-item")).toHaveCount(1);

  await login(page, PHONES.teacher);
  // Teacher got a notification
  const { data: notes } = await db.from("notifications").select("params").eq("type", "absence.reported").eq("kindergarten_id", A).order("created_at", { ascending: false }).limit(1);
  expect(notes?.[0]?.params).toMatchObject({ reason: "sick" });
  await expect(page.getByTestId("teacher-today-absent")).toContainText("Алихан");
  await page.goto("/attendance");
  await expect(child(page, "Алихан")).toHaveAttribute("data-status", "absent");
  await expect(child(page, "Алихан").getByTestId("child-report")).toContainText("Болеет");
  await expect(child(page, "Алихан").getByTestId("child-report")).toContainText("Температура");

  await login(page, PHONES.cook);
  await expect(portions(page, "Солнышко")).toHaveText(String(before - 1));
  await expect(page.getByTestId("portions-total")).toHaveText(String(totalBefore - 1));
  await cleanToday();
});

test("scenario 4: teacher marks → parent sees «Сегодня в саду» → owner's attendance card updates", async ({ page }) => {
  await cleanToday();
  await login(page, PHONES.owner);
  const before = Number(await page.getByTestId("dash-attendance-present").innerText());

  await login(page, PHONES.teacher);
  await page.goto("/attendance");
  await expect(child(page, "Алихан")).toHaveAttribute("data-status", "none");
  await child(page, "Алихан").getByTestId("mark-present").click();
  await expect(child(page, "Алихан")).toHaveAttribute("data-status", "present");
  await expect(page.getByTestId("attendance-progress")).toHaveText("1 из 3");
  await page.reload();
  await expect(child(page, "Алихан")).toHaveAttribute("data-status", "present");

  await login(page, PHONES.parent);
  await expect(page.getByTestId("child-today-status")).toHaveText("Сегодня в саду");

  await login(page, PHONES.owner);
  await expect(page.getByTestId("dash-attendance-present")).toHaveText(String(before + 1));
});

test("«Все пришли», then unmark the absent one", async ({ page }) => {
  await cleanToday();
  await login(page, PHONES.teacher);
  await page.goto("/attendance");
  await page.getByTestId("mark-all-present").click();
  await expect(page.locator('[data-testid="attendance-child"][data-status="present"]')).toHaveCount(3);
  await expect(page.getByTestId("attendance-progress")).toHaveText("3 из 3");
  await expect(page.getByTestId("mark-all-present")).toHaveCount(0);
  await child(page, "Айлин").getByTestId("mark-absent").click();
  await expect(child(page, "Айлин")).toHaveAttribute("data-status", "absent");
  await page.reload();
  await expect(child(page, "Айлин")).toHaveAttribute("data-status", "absent");
  await expect(page.getByTestId("attendance-present-count")).toHaveText("2");
  await cleanToday();
});

test("parent cancels a future report", async ({ page }) => {
  await cleanToday();
  await login(page, PHONES.parent);
  await page.getByTestId("report-absence").first().click();
  await page.getByTestId("absence-from").fill(addDays(today, 1));
  await page.getByTestId("absence-reason-vacation").click();
  await page.getByTestId("absence-submit").click();
  await expect(page.getByTestId("absence-done")).toBeVisible();
  await expect(page.getByTestId("absence-sick-hint")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("absence-item")).toHaveCount(1);
  await expect(page.getByTestId("child-today-status")).toHaveText("Ещё не отмечен");
  await page.getByTestId("cancel-absence").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("absence-item")).toHaveCount(0);
  const { data } = await db.from("absence_reports").select("cancelled_at").eq("child_id", alikhan).gte("date_from", today);
  expect(data?.every((r) => r.cancelled_at)).toBe(true);
  await cleanToday();
});

test("teacher can't open another group; cook can't open the lists of names", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto(`/attendance?group=${gA2}`);
  await expect(page.getByTestId("attendance-forbidden")).toBeVisible();
  await expect(page.getByText("Бекова Сабина")).toHaveCount(0);
  await page.goto(`/attendance/report?group=${gA2}`);
  await expect(page.getByTestId("attendance-forbidden")).toBeVisible();
  expect((await page.request.get(`/attendance/export?group=${gA2}&month=${today.slice(0, 7)}`)).status()).toBe(403);

  await login(page, PHONES.cook);
  await page.goto(`/attendance?group=${gA1}`);
  await expect(page).toHaveURL((u) => u.pathname === "/");
  await expect(page.getByText("Ахметов Алихан")).toHaveCount(0);
  await page.goto("/attendance/report");
  await expect(page).toHaveURL((u) => u.pathname === "/");
  expect((await page.request.get(`/attendance/export?group=${gA1}&month=${today.slice(0, 7)}`)).status()).toBe(403);
});

test("head: month report and .xlsx export; edits a past day", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto(`/attendance/report?group=${gA1}`);
  await expect(page.getByTestId("report-row")).toHaveCount(3);
  const res = await page.request.get(`/attendance/export?group=${gA1}&month=${today.slice(0, 7)}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");
  expect((await res.body()).subarray(0, 2).toString()).toBe("PK");

  // A past working day is editable for the head and audited.
  let d = addDays(today, -1);
  for (let i = 0; i < 10; i++) {
    const { data } = await db.rpc("kg_is_working_day", { kg: A, d });
    if (data) break;
    d = addDays(d, -1);
  }
  await page.goto(`/attendance?group=${gA1}&date=${d}`);
  const row = child(page, "Айлин");
  const was = await row.getAttribute("data-status");
  const next = was === "present" ? "absent" : "present";
  await row.getByTestId(next === "present" ? "mark-present" : "mark-absent").click();
  await expect(row).toHaveAttribute("data-status", next);
  await expect
    .poll(async () => {
      const { data } = await db.from("audit_log").select("details").eq("kindergarten_id", A).eq("action", "attendance.edit_past").order("id", { ascending: false }).limit(1);
      return data?.[0]?.details;
    })
    .toMatchObject({ date: d, status: next });

  // Teacher sees that day read-only.
  await login(page, PHONES.teacher);
  await page.goto(`/attendance?group=${gA1}&date=${d}`);
  await expect(page.getByTestId("attendance-readonly")).toBeVisible();
  await expect(page.getByTestId("mark-present")).toHaveCount(0);
});

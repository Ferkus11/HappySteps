import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PASSWORD, PHONES, expectToast, login, randomPhone } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
const TZ = "Asia/Almaty";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const prevMonth = () => {
  const [y, m] = today().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

async function ids() {
  const { data: kg } = await svc.from("kindergartens").select("id").eq("slug", "e2e-a").single();
  const { data: people } = await svc.from("profiles").select("id, phone").in("phone", [PHONES.teacher, PHONES.head]);
  const id = (p: string) => people!.find((x) => x.phone === p)!.id as string;
  return { kg: kg!.id as string, teacher: id(PHONES.teacher), head: id(PHONES.head) };
}

async function tile(page: Page, name: "late" | "work" | "absent" | "unmarked") {
  return Number(await page.getByTestId(`tile-${name}`).first().innerText());
}

test.afterEach(async () => {
  const { kg } = await ids();
  await svc.from("kindergarten_settings").update({ late_threshold_minutes: 10 }).eq("kindergarten_id", kg);
});

test("scenario 2: a teacher starts the day late → head's tile «Опоздал» +1; finish and a second interval", async ({ page }) => {
  const { kg, teacher } = await ids();
  const d = today();
  // Deterministic setup: today the teacher's shift started an hour ago (threshold is 10 min).
  await svc.from("work_sessions").delete().eq("user_id", teacher).eq("kindergarten_id", kg).or(`work_date.eq.${d},ended_at.is.null`);
  if (nowMinutes() === 0) await page.waitForTimeout(61_000);
  const now = nowMinutes();
  const start = Math.max(0, now - 60);
  // Just after midnight the shift can't start an hour earlier: lower the late threshold for the run.
  const nearMidnight = now - start <= 10;
  if (nearMidnight) await svc.from("kindergarten_settings").update({ late_threshold_minutes: 0 }).eq("kindergarten_id", kg);
  test.info().annotations.push({ type: "nearMidnight", description: String(nearMidnight) });
  const end = Math.min(23 * 60 + 59, Math.max(now + 240, start + 1));
  const { error } = await svc
    .from("schedule_overrides")
    .upsert({ kindergarten_id: kg, user_id: teacher, date: d, kind: "shift", start_time: hhmm(start), end_time: hhmm(end), note: "e2e" }, { onConflict: "kindergarten_id,user_id,date" });
  expect(error).toBeNull();

  await login(page, PHONES.head);
  await expect(page.getByTestId("tile-late")).toBeVisible();
  const before = await tile(page, "late");

  await login(page, PHONES.teacher);
  await page.getByTestId("worktime-start").click();
  await expectToast(page, "Рабочий день начат");
  await expect(page.getByTestId("worktime-finish")).toBeVisible();
  await expect(page.getByTestId("workday-card")).toContainText("Опоздание");

  await login(page, PHONES.head);
  await expect(page.getByTestId("tile-late")).toHaveText(String(before + 1));
  await page.getByTestId("worktime-staff-list").click();
  await expect(page).toHaveURL(/\/worktime/);
  await expect(page.getByTestId(`wt-row-${teacher}`)).toContainText("Опоздал");

  // Finish, then start again: a new interval, hours add up.
  await login(page, PHONES.teacher);
  await page.goto("/worktime");
  await page.getByTestId("worktime-finish").click();
  await expectToast(page, "Рабочий день закончен");
  await expect(page.getByTestId("worktime-start")).toBeVisible();
  await page.getByTestId("worktime-start").click();
  await expect(page.getByTestId("worktime-finish")).toBeVisible();
  await expect(page.getByTestId("workday-card")).toContainText("2 интервала");
  await page.getByTestId("worktime-finish").click();
  await expect(page.getByTestId("worktime-start")).toBeVisible();
  const { count } = await svc.from("work_sessions").select("id", { count: "exact", head: true }).eq("user_id", teacher).eq("work_date", d);
  expect(count).toBe(2);
  await expect(page.getByTestId("my-days")).toBeVisible();
});

test("head corrects time: a comment is required, the day is marked «Изменено» in the timesheet", async ({ page }) => {
  const { kg, teacher } = await ids();
  const { data: s } = await svc
    .from("work_sessions")
    .select("id, work_date")
    .eq("kindergarten_id", kg)
    .eq("user_id", teacher)
    .lt("work_date", today())
    .order("work_date", { ascending: false })
    .limit(1)
    .single();
  const day = s!.work_date as string;
  await login(page, PHONES.head);
  await page.goto(`/worktime/people/${teacher}?month=${day.slice(0, 7)}`);
  const row = page.getByTestId(`day-${day}`);
  await row.getByTestId("edit-session").first().click();
  await page.getByTestId("session-start").fill("07:30");
  await page.getByTestId("session-save").click();
  await expect(page.getByRole("alert").filter({ hasText: "Укажите комментарий" })).toBeVisible();
  await page.getByTestId("session-comment").fill("Пришла раньше, отметка забыта");
  await page.getByTestId("session-save").click();
  await expectToast(page, "Сохранено");
  await expect(row).toContainText("07:30");
  await expect(row.getByTestId("marker-edited")).toBeVisible();
  await expect(row).toContainText("Пришла раньше, отметка забыта");

  await page.goto(`/worktime/timesheet?month=${day.slice(0, 7)}`);
  await expect(page.getByTestId(`ts-row-${teacher}`).getByTestId("ts-edited").first()).toBeVisible();
  await expect(page.getByTestId("ts-edit").first()).toBeVisible();

  // The owner sees the correction in the audit log.
  await login(page, PHONES.owner);
  await page.goto("/audit?action=worktime");
  // (The audit page currently prints dotted action keys raw — label lookup is a foundation issue.)
  await expect(page.getByText(/Правка табеля \(время работы\)|worktime\.edit/).first()).toBeVisible();
});

test("accountant: timesheet and today's statuses read-only, exports work; teacher and parent are kept out", async ({ page }) => {
  const { teacher } = await ids();
  await login(page, PHONES.accountant);
  await expect(page.getByTestId("tile-late")).toBeVisible();
  await page.goto("/worktime/timesheet");
  await expect(page.getByTestId("timesheet")).toBeVisible();
  await expect(page.getByTestId(`ts-row-${teacher}`)).toBeVisible();
  await expect(page.getByTestId("ts-edit")).toHaveCount(0);
  await page.goto(`/worktime/people/${teacher}`);
  await expect(page.getByTestId("person-name")).toBeVisible();
  await expect(page.getByTestId("edit-session")).toHaveCount(0);
  await expect(page.getByTestId("add-session")).toHaveCount(0);
  await expect(page.getByTestId("schedule-save")).toHaveCount(0);

  const month = today().slice(0, 7);
  const xlsx = await page.request.get(`/worktime/timesheet/export?month=${month}&format=xlsx`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  const pdf = await page.request.get(`/worktime/timesheet/export?month=${month}&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await test.info().attach("timesheet.pdf", { body: await pdf.body(), contentType: "application/pdf" });

  await login(page, PHONES.teacher);
  for (const f of ["xlsx", "pdf"]) {
    const r = await page.request.get(`/worktime/timesheet/export?month=${month}&format=${f}`);
    expect(r.status()).toBe(403);
  }
  await page.goto("/worktime/timesheet");
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/worktime/people/${teacher}`);
  await expect(page).toHaveURL(/\/$/);

  await login(page, PHONES.parent);
  await page.goto("/worktime");
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get(`/worktime/timesheet/export?month=${month}&format=xlsx`)).status()).toBe(403);
});

test("scenario 9 (part 2): an archived employee cannot log in, their past timesheet stays", async ({ page }) => {
  const { kg } = await ids();
  const phone = randomPhone();
  const name = `Архивова Тест ${Date.now().toString(36)}`;
  const created = await svc.auth.admin.createUser({ email: `${phone.slice(1)}@${domain}`, password: PASSWORD, email_confirm: true });
  expect(created.error).toBeNull();
  const uid = created.data.user!.id;
  expect((await svc.from("profiles").insert({ id: uid, full_name: name, phone, activated_at: new Date().toISOString() })).error).toBeNull();
  expect((await svc.from("memberships").insert({ user_id: uid, kindergarten_id: kg, role: "teacher", consent_at: new Date().toISOString() })).error).toBeNull();
  const pm = prevMonth();
  const sessions = ["10", "11"].map((d) => ({
    kindergarten_id: kg,
    user_id: uid,
    work_date: `${pm}-${d}`,
    started_at: `${pm}-${d}T08:00:00+05:00`,
    ended_at: `${pm}-${d}T17:00:00+05:00`,
  }));
  expect((await svc.from("work_sessions").insert(sessions)).error).toBeNull();

  await login(page, PHONES.owner);
  await page.goto("/staff");
  await page.getByTestId(`staff-${phone}`).click();
  await page.getByTestId("archive-person").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByText("В архиве").first()).toBeVisible();

  await login(page, phone);
  await expect(page).toHaveURL(/\/no-access/);

  await login(page, PHONES.owner);
  await page.goto(`/worktime/timesheet?month=${pm}`);
  const row = page.getByTestId(`ts-row-${uid}`);
  await expect(row).toContainText(name);
  await expect(row).toContainText("в архиве");
  await expect(row.getByTestId("ts-hours")).toHaveText("18");
});

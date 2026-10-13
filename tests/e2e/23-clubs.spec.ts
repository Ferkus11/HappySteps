import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PHONES, expectToast, login } from "./helpers";
import { gradientPng, seedClubs } from "../../scripts/seed/e2e-clubs";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let A = "";
const users: Record<string, string> = {};
let clubs: Record<string, string> = {};
let toddler = ""; // a temporary second child of the parent (2 years old) for the age filter / child switch
const TODDLER = "Ахметова Аружан Даниярқызы";
const LEAVER = "Тестов Архип Е2Е"; // a temporary child archived by the head (place frees → «Освободилось место»)

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const yearsAgo = (n: number, days = 30) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

const card = (page: Page, name: string) => page.locator(`[data-testid="club-card"][data-club="${name}"]`);
const notifications = async (type: string, userId: string) =>
  (await db.from("notifications").select("params").eq("kindergarten_id", A).eq("type", type).eq("user_id", userId)).data ?? [];

test.beforeAll(async () => {
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  for (const [k, phone] of Object.entries(PHONES)) {
    const p = (await db.from("profiles").select("id").eq("phone", phone).maybeSingle()).data;
    if (p) users[k] = p.id;
  }
  // Re-runnable: drop clubs made by earlier runs, rebuild the fixtures, forget old club notifications.
  await db.from("clubs").delete().eq("kindergarten_id", A).like("name", "E2E %");
  await db.from("children").delete().eq("kindergarten_id", A).in("full_name", [TODDLER, LEAVER]);
  clubs = await seedClubs(db, { users, kindergartens: { A } });
  await db.from("notifications").delete().eq("kindergarten_id", A).like("type", "club.%");
  const { data: g } = await db.from("groups").select("id").eq("kindergarten_id", A).eq("name", "Солнышко").single();
  toddler = (await db.from("children").insert({ kindergarten_id: A, full_name: TODDLER, birth_date: yearsAgo(2), group_id: g!.id, monthly_fee: 0 }).select("id").single()).data!.id;
  await db.from("child_guardians").insert({ child_id: toddler, user_id: users.parent, kindergarten_id: A, relation: "мама" });
});

test.afterAll(async () => {
  if (toddler) await db.from("children").delete().eq("id", toddler);
});

test("scenario 6: full club → queue → a place frees → the head confirms", async ({ page }) => {
  // Parent: «Шахматы» (1 place, taken by Миша) suits Алихан (5) — «Записаться» puts him in the queue.
  await login(page, PHONES.parent);
  await page.goto("/clubs");
  await expect(card(page, "Шахматы").getByTestId("club-places")).toHaveAttribute("data-free", "0");
  await card(page, "Шахматы").click();
  await expect(page.getByTestId("enroll-panel")).toContainText("Мест нет");
  await page.getByTestId("enroll").click();
  await expectToast(page, "в очереди, место №1");
  await expect(page.getByTestId("enroll-panel").getByTestId("enrollment-status")).toHaveAttribute("data-status", "queued");
  await expect(page.getByTestId("enroll-panel").getByTestId("enrollment-status")).toHaveText("В очереди · №1");
  expect(await notifications("club.request", users.head)).toHaveLength(1);
  expect(await notifications("club.request", users.clubTeacher)).toHaveLength(1);

  // Head: nothing to confirm yet; excludes Миша → place frees → «Освободилось место».
  await login(page, PHONES.head);
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  const queued = page.getByTestId("club-queue").getByTestId("roster-row").filter({ hasText: "Алихан" });
  await expect(queued.getByTestId("confirm-enrollment")).toBeDisabled();
  await page.getByTestId("club-attending").getByTestId("roster-row").filter({ hasText: "Миша" }).getByTestId("exclude-enrollment").click();
  await page.getByLabel("Причина").fill("Семья переезжает");
  await page.getByTestId("reason-ok").click();
  await expectToast(page, "Ребёнок исключён");
  expect(await notifications("club.spot_free", users.head)).toEqual([{ params: { club: "Шахматы", count: 1 } }]);
  const { data: log } = await db.from("audit_log").select("details").eq("kindergarten_id", A).eq("action", "club.exclude").order("created_at", { ascending: false }).limit(1);
  expect(log![0].details).toMatchObject({ club: "Шахматы", reason: "Семья переезжает" });

  await page.goto("/clubs");
  const item = page.getByTestId("pending-item").filter({ hasText: "Алихан" });
  await expect(item).toContainText("Освободилось место");
  await item.getByTestId("confirm-enrollment").click();
  await expectToast(page, "Ребёнок записан");
  await expect(page.getByTestId("pending-item").filter({ hasText: "Алихан" })).toHaveCount(0);

  // Parent: «Записан», and a notification about it.
  expect((await notifications("club.decision", users.parent)).map((n) => n.params)).toContainEqual({ club: "Шахматы", child: "Ахметов Алихан Даниярович", status: "active" });
  await login(page, PHONES.parent);
  await expect(page.getByTestId("parent-clubs").getByTestId("parent-club").filter({ hasText: "Шахматы" }).getByTestId("enrollment-status")).toHaveText("Записан");
});

test("parent: catalog by each child's age, request and withdraw", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.goto("/clubs");
  // Алихан (5): Танцы (2–3) is not offered; his chess club is in «Записи».
  await expect(page.getByTestId("my-enrollment").filter({ hasText: "Шахматы" })).toBeVisible();
  await expect(card(page, "Рисование")).toBeVisible();
  await expect(card(page, "Английский язык")).toBeVisible();
  await expect(card(page, "Танцы")).toHaveCount(0);
  // switch to the 2-year-old: only «Танцы»
  await page.getByTestId("child-switch").filter({ hasText: "Аружан" }).click();
  await expect(page).toHaveURL(new RegExp(`child=${toddler}`));
  await expect(card(page, "Танцы")).toBeVisible();
  await expect(card(page, "Рисование")).toHaveCount(0);
  await card(page, "Танцы").click();
  await page.getByTestId("enroll").click();
  await expectToast(page, "Заявка отправлена");
  await expect(page.getByTestId("enrollment-status")).toHaveAttribute("data-status", "requested");
  // a club for other ages explains why it cannot be joined
  await page.goto(`/clubs/${clubs["Шахматы"]}?child=${toddler}`);
  await expect(page.getByTestId("not-for-age")).toContainText("4–7 лет");
  await expect(page.getByTestId("enroll")).toHaveCount(0);
  // withdraw the request
  await page.goto(`/clubs/${clubs["Танцы"]}?child=${toddler}`);
  await page.getByTestId("leave-club").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Готово");
  await expect(page.getByTestId("enroll")).toBeVisible();
  const { data } = await db.from("club_enrollments").select("status").eq("child_id", toddler);
  expect(data!.map((r) => r.status)).toEqual(["left"]);
});

test("head: create a club with a photo, edit it, delete it (audited)", async ({ page }) => {
  const name = `E2E Лепка ${Date.now() % 100000}`;
  await login(page, PHONES.head);
  await page.goto("/clubs");
  await page.getByTestId("add-club").click();
  await page.getByTestId("club-name").fill(name);
  await page.getByTestId("club-age-from").fill("3");
  await page.getByTestId("club-age-to").fill("5");
  await page.getByTestId("club-capacity").fill("2");
  await page.getByTestId("add-time").click();
  await page.getByTestId("club-teacher").selectOption({ label: "Петров Игорь Сергеевич" });
  await page.getByTestId("club-photo").setInputFiles({ name: "clay.png", mimeType: "image/png", buffer: gradientPng(160, 90) });
  await page.getByTestId("save-club").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByTestId("club-info")).toContainText("3–5 лет");
  await expect(page.getByTestId("club-info")).toContainText("Пн, Вт · 16:00–16:45");
  await expect(page.getByTestId("club-info").locator("img")).toHaveCount(1);
  const id = page.url().split("/").pop()!;
  const { data: row } = await db.from("clubs").select("photo_path, teacher_id, capacity").eq("id", id).single();
  expect(row!.photo_path).toMatch(new RegExp(`^${A}/clubs/`));
  expect(row!.teacher_id).toBe(users.clubTeacher);

  await page.getByTestId("edit-club").click();
  await page.getByTestId("club-capacity").fill("6");
  await page.getByTestId("save-club").click();
  await expectToast(page, "Кружок сохранён");
  await expect(page.getByTestId("club-info")).toContainText("Свободно 6 из 6");

  await page.getByTestId("delete-club").click();
  await page.getByTestId("confirm-ok").click();
  await page.waitForURL((u) => u.pathname === "/clubs");
  await expect(card(page, name)).toHaveCount(0);
  const { data: log } = await db.from("audit_log").select("details").eq("action", "club.delete").eq("entity_id", id);
  expect(log![0].details).toMatchObject({ name });
});

test("club teacher: own clubs only, confirms a request, roster with phones and «Написать»", async ({ page }) => {
  await login(page, PHONES.clubTeacher);
  await expect(page.getByTestId("teacher-clubs")).toHaveAttribute("data-count", "1"); // Айлин → Рисование
  await page.goto("/clubs");
  await expect(page.getByTestId("my-clubs").getByTestId("club-card")).toHaveCount(2);
  await expect(card(page, "Английский язык")).toHaveCount(0);
  await page.getByTestId("pending-item").filter({ hasText: "Айлин" }).getByTestId("confirm-enrollment").click();
  await expectToast(page, "Ребёнок записан");
  await expect(page.getByTestId("pending-requests")).toHaveAttribute("data-count", "0");
  // another teacher's club is not reachable
  const res = await page.goto(`/clubs/${clubs["Английский язык"]}`);
  expect(res?.status()).toBe(404);
  // roster of «Шахматы»: Алихан with his parent's phone; write to the parent
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  const row = page.getByTestId("club-attending").getByTestId("roster-row").filter({ hasText: "Алихан" });
  await expect(row.getByTestId("parent-phone")).toHaveText("+7 (701) 000-00-07");
  await expect(row.getByTestId("parent-phone")).toHaveAttribute("href", "tel:+77010000007");
  await expect(row.getByTestId("exclude-enrollment")).toHaveCount(0); // administration only
  await row.getByTestId("write-parent").click();
  await page.waitForURL(/\/chats\/[0-9a-f-]{36}/);
  await expect(page.getByText("Ахметов Данияр Болатович").first()).toBeVisible();
});

test("parent can write first to the club teacher of an attended club", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.goto("/chats");
  await page.getByTestId("new-chat").click();
  await expect(page.getByRole("dialog")).toContainText("Петров Игорь Сергеевич");
});

test("archiving an enrolled child frees the place and tells the head about the queue", async ({ page }) => {
  const name = `E2E Архив ${Date.now() % 100000}`;
  const club = (await db.from("clubs").insert({ kindergarten_id: A, name, age_from: 0, age_to: 17, capacity: 1 }).select("id").single()).data!.id as string;
  const { data: g } = await db.from("groups").select("id").eq("kindergarten_id", A).eq("name", "Солнышко").single();
  const leaver = (await db.from("children").insert({ kindergarten_id: A, full_name: LEAVER, birth_date: yearsAgo(4), group_id: g!.id, monthly_fee: 0 }).select("id").single()).data!.id as string;
  const { data: ailin } = await db.from("children").select("id").eq("kindergarten_id", A).ilike("full_name", "%Айлин%").single();
  await db.from("club_enrollments").insert([
    { kindergarten_id: A, club_id: club, child_id: leaver, status: "active", started_on: new Date().toISOString() },
    { kindergarten_id: A, club_id: club, child_id: ailin!.id, status: "queued", queue_no: 1 },
  ]);
  try {
    await login(page, PHONES.head);
    await page.goto(`/children/${leaver}`);
    await page.getByTestId("archive-child").click();
    await page.getByTestId("archive-child-submit").click();
    await expect.poll(async () => (await db.from("children").select("status").eq("id", leaver).single()).data!.status).toBe("archived");
    await expect.poll(async () => (await notifications("club.spot_free", users.head)).filter((n) => n.params.club === name)).toEqual([{ params: { club: name, count: 1 } }]);
    const { data: rows } = await db.from("club_enrollments").select("status").eq("club_id", club).eq("child_id", leaver);
    expect(rows!.map((r) => r.status)).toEqual(["left"]);
    await page.goto(`/clubs/${club}`);
    await expect(page.getByTestId("club-places").first()).toHaveAttribute("data-free", "1");
  } finally {
    await db.from("children").delete().eq("id", leaver);
    await db.from("clubs").delete().eq("id", club);
  }
});

test("teacher and accountant: read-only; cook: no access", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/clubs");
  await expect(card(page, "Шахматы")).toBeVisible();
  await expect(page.getByTestId("add-club")).toHaveCount(0);
  await card(page, "Шахматы").click();
  await expect(page.getByTestId("club-info")).toBeVisible();
  await expect(page.getByTestId("club-attending")).toHaveCount(0);
  await expect(page.getByTestId("edit-club")).toHaveCount(0);

  await login(page, PHONES.accountant);
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  await expect(page.getByTestId("club-attending").getByTestId("roster-row")).toHaveCount(1);
  await expect(page.getByTestId("exclude-enrollment")).toHaveCount(0);
  await expect(page.getByTestId("write-parent")).toHaveCount(0);
  await expect(page.getByTestId("delete-club")).toHaveCount(0);

  await login(page, PHONES.cook);
  await page.goto("/clubs");
  await expect(page).toHaveURL((u) => u.pathname === "/");
});

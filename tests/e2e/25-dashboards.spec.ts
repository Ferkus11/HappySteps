import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, PHONES, login, randomPhone, switchContext } from "./helpers";
import { db, prepareDashboards, today, type DashState } from "./dashboards-setup";

test.describe.configure({ mode: "serial" });

let S: DashState;

test.beforeAll(async () => {
  S = await prepareDashboards();
});

test.afterAll(async () => {
  await S?.restore();
});

/** Dashboard of the current role, every widget streamed in. */
async function dashboard(page: Page, role: string) {
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-role", role);
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
}

const visible = (page: Page, ids: string[]) => Promise.all(ids.map((id) => expect(page.getByTestId(id).first(), id).toBeVisible()));
const absent = (page: Page, ids: string[]) => Promise.all(ids.map((id) => expect(page.getByTestId(id), id).toHaveCount(0)));

const ADMIN_ONLY = ["dash-stats", "attention-card", "waitlist-widget"];
const PARENT_ONLY = ["parent-today", "my-child", "parent-payment"];
const STAFF_ONLY = ["workday-card", "receipts-pending", "timesheet-widget", "menu-kitchen", "portions-card", "teacher-today"];

test("owner: top row with payments, work time, menu, events; right column with attention and waitlist", async ({ page }) => {
  await login(page, PHONES.owner);
  await dashboard(page, "owner");
  await visible(page, ["dash-children", "dash-groups", "dash-attendance-present", "dash-payments", "worktime-staff-list", "menu-today", "upcoming-events", "attention-card", "waitlist-widget"]);
  await absent(page, [...PARENT_ONLY, "receipts-pending", "teacher-today", "menu-kitchen", "timesheet-widget"]);
  // Every top-row card leads to its section.
  await expect(page.getByTestId("dash-children-card")).toHaveAttribute("href", "/children");
  await expect(page.getByTestId("dash-groups-card")).toHaveAttribute("href", "/groups");
  // The right column holds the side cards on desktop.
  await expect(page.locator('[data-slot="side"] [data-testid="attention-card"]')).toBeVisible();
  await expect(page.locator('[data-slot="side"] [data-testid="waitlist-widget"]')).toBeVisible();
});

test("head: same layout without «Оплаты месяца»; no receipts line she can't act on", async ({ page }) => {
  await login(page, PHONES.head);
  await dashboard(page, "head");
  await visible(page, ["dash-children", "dash-groups", "dash-attendance-present", "attention-card", "waitlist-widget", "menu-today"]);
  await absent(page, ["dash-payments", ...PARENT_ONLY, "receipts-pending"]);
  // A receipt waits for review (prepareDashboards), but checking it is the accountant's job.
  await expect(page.getByTestId("attention-item").first()).toBeVisible();
  await expect(page.locator('[data-testid="attention-item"][data-kind="receipts"]')).toHaveCount(0);
  await expect(page.getByText("Проверяет бухгалтер")).toHaveCount(0);
});

test("«Требует внимания»: an unmarked group and a receipt awaiting review, the links lead to the sections", async ({ page }) => {
  await login(page, PHONES.head);
  await dashboard(page, "head");
  const card = page.getByTestId("attention-card");
  const receipts = card.locator('[data-testid="attention-item"][data-kind="receipts"]');
  const groups = card.locator('[data-testid="attention-item"][data-kind="unmarkedGroups"]');
  await expect(receipts).toHaveCount(0); // head: receipts are not hers to act on
  await expect(groups).toBeVisible();
  expect(Number(await groups.getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await expect(card.getByTestId("attention-empty")).toHaveCount(0);

  await groups.click();
  await page.waitForURL(/\/attendance/);
  await expect(page.getByTestId("attendance-progress")).toBeVisible();

  // The owner sees the receipt line, with the action hint, and it leads to the review queue.
  await login(page, PHONES.owner);
  await dashboard(page, "owner");
  const ownerReceipts = page.locator('[data-testid="attention-item"][data-kind="receipts"]');
  await expect(ownerReceipts).toContainText("Подтвердите или отклоните оплату");
  expect(Number(await ownerReceipts.getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await ownerReceipts.click();
  await page.waitForURL("**/payments");
  await expect(page.getByTestId("pending-count")).toBeVisible();
});

test("accountant: receipts, debtors, accrued/paid, timesheet — no owner cards", async ({ page }) => {
  await login(page, PHONES.accountant);
  await dashboard(page, "accountant");
  await visible(page, ["receipts-pending", "dash-debtors", "accrued-paid", "timesheet-widget"]);
  expect(Number(await page.getByTestId("receipts-pending").getAttribute("data-count"))).toBeGreaterThanOrEqual(1);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "upcoming-events", "worktime-staff-list"]);
  await page.getByTestId("timesheet-open").click();
  await page.waitForURL(/\/worktime\/timesheet/);
});

test("teacher: work day, my group today with «Отметить», menu, group chat, events", async ({ page }) => {
  await login(page, PHONES.teacher);
  await dashboard(page, "teacher");
  await visible(page, ["workday-card", "teacher-today", "teacher-mark", "menu-today", "widget-group-chat", "upcoming-events"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "receipts-pending", "menu-kitchen"]);
});

test("cook: menu today/tomorrow, portions by group, allergies", async ({ page }) => {
  await login(page, PHONES.cook);
  await dashboard(page, "cook");
  await visible(page, ["menu-kitchen", "menu-kitchen-today", "menu-kitchen-tomorrow", "portions-card", "allergies-list"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "receipts-pending", "teacher-today"]);
});

test("club teacher: work day, my clubs and requests, chats", async ({ page }) => {
  await login(page, PHONES.clubTeacher);
  await dashboard(page, "club_teacher");
  await visible(page, ["workday-card", "widget-chats"]);
  await absent(page, [...ADMIN_ONLY, ...PARENT_ONLY, "menu-today", "portions-card", "receipts-pending", "teacher-today"]);
});

test("parent: child card with today's status and «Ребёнок не придёт», menu, payment, events — no staff cards", async ({ page }) => {
  await login(page, PHONES.parent);
  await dashboard(page, "parent");
  await visible(page, ["parent-today", "my-child", "child-today-status", "report-absence", "menu-today", "upcoming-events"]);
  await expect(page.getByTestId("my-child")).toContainText("Алихан");
  await absent(page, [...ADMIN_ONLY, ...STAFF_ONLY, "dash-payments", "widget-group-chat"]);
});

test("teacher who is also a parent sees the dashboard of the current role", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  await switchContext(page, "Happy Steps E2E", "Родитель");
  await dashboard(page, "parent");
  await expect(page.getByTestId("my-child")).toContainText("Миша");
  await absent(page, ["teacher-today", "workday-card"]);
  await switchContext(page, "Happy Steps E2E", "Воспитатель");
  await dashboard(page, "teacher");
  await expect(page.getByTestId("teacher-today").first()).toContainText("Звёздочки");
  await absent(page, ["parent-today", "my-child"]);
});

/** Primary buttons (filled brand) inside the dashboard: SPEC §8 allows one per screen. */
const primaries = (page: Page) => page.locator('[data-testid="dashboard"] :is(a, button).bg-brand.text-brand-fg');

test("one primary action per dashboard (SPEC §8)", async ({ page }) => {
  for (const [who, role] of [
    ["owner", "owner"],
    ["head", "head"],
    ["accountant", "accountant"],
    ["teacher", "teacher"],
    ["clubTeacher", "club_teacher"],
    ["cook", "cook"],
    ["parent", "parent"],
  ] as const) {
    await login(page, PHONES[who]);
    await dashboard(page, role);
    expect(await primaries(page).count(), role).toBeLessThanOrEqual(1);
  }
  // Accountant: «Проверить» is secondary next to «Начать рабочий день».
  await login(page, PHONES.accountant);
  await dashboard(page, "accountant");
  await expect(page.getByTestId("receipts-check")).not.toHaveClass(/bg-brand/);
  // Parent: «Ребёнок не придёт» is the one primary; «Загрузить чек» on the dashboard is outline.
  await login(page, PHONES.parent);
  await dashboard(page, "parent");
  await expect(page.getByTestId("report-absence").first()).toHaveClass(/bg-brand/);
  const upload = page.getByTestId("upload-receipt");
  for (let i = 0; i < (await upload.count()); i++) await expect(upload.nth(i)).not.toHaveClass(/bg-brand/);
});

test("teacher: «Отметить» is secondary until the work day starts, then primary", async ({ page }) => {
  const teacher = (await db.from("profiles").select("id").eq("phone", PHONES.teacher).single()).data!.id as string;
  await db.from("work_sessions").delete().eq("user_id", teacher).is("ended_at", null);
  await login(page, PHONES.teacher);
  await dashboard(page, "teacher");
  const mark = page.getByTestId("teacher-mark").first();
  await expect(page.getByTestId("worktime-start")).toHaveClass(/bg-brand/);
  await expect(mark).toHaveAttribute("data-variant", "secondary");
  expect(await primaries(page).count()).toBe(1);
  await page.getByTestId("worktime-start").click();
  await expect(page.getByTestId("worktime-finish")).toBeVisible();
  await expect(mark).toHaveAttribute("data-variant", "primary");
  expect(await primaries(page).count()).toBe(1);
  // remove the session this test opened (other specs start the day themselves)
  await db.from("work_sessions").delete().eq("user_id", teacher).is("ended_at", null);
});

test("teacher who is also a parent, viewing as parent, sees only parent events", async ({ page }) => {
  const groups = (await db.from("groups").select("id, name").eq("kindergarten_id", S.A)).data!;
  const gid = (name: string) => groups.find((g) => g.name === name)!.id as string;
  const owner = (await db.from("profiles").select("id").eq("phone", PHONES.owner).single()).data!.id as string;
  await db.from("events").delete().like("title", "E2E-dash %");
  const tag = Date.now().toString(36);
  const mk = async (title: string, audience: string, group?: string) => {
    const { data, error } = await db
      .from("events")
      .insert({ kindergarten_id: S.A, author_id: owner, audience, kind: "other", title: `E2E-dash ${title} ${tag}`, date: today, start_time: null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (group) await db.from("event_groups").insert({ event_id: data.id, group_id: group, kindergarten_id: S.A });
  };
  await mk("Педсовет", "staff");
  await mk("Звёздочки", "groups", gid("Звёздочки")); // her teaching group, not Миша's
  await mk("Солнышко", "groups", gid("Солнышко")); // Миша's group
  await mk("Для всех", "all");
  try {
    await login(page, PHONES.teacherParent);
    await switchContext(page, "Happy Steps E2E", "Родитель");
    await dashboard(page, "parent");
    const card = page.getByTestId("upcoming-events");
    await expect(card).not.toContainText(`Педсовет ${tag}`);
    await expect(card).not.toContainText(`Звёздочки ${tag}`);
    await page.goto(`/events?month=${today.slice(0, 7)}&day=${today}`);
    const day = page.getByTestId("selected-day");
    await expect(day).toContainText(`Для всех ${tag}`);
    await expect(day).toContainText(`Солнышко ${tag}`);
    await expect(day).not.toContainText(`Педсовет ${tag}`);
    await expect(day).not.toContainText(`Звёздочки ${tag}`);
    await expect(page.getByTestId("upcoming-list")).not.toContainText(`Педсовет ${tag}`);

    // As teacher she sees the staff event and her own group's event again.
    await switchContext(page, "Happy Steps E2E", "Воспитатель");
    await page.goto(`/events?month=${today.slice(0, 7)}&day=${today}`);
    await expect(page.getByTestId("selected-day")).toContainText(`Педсовет ${tag}`);
    await expect(page.getByTestId("selected-day")).toContainText(`Звёздочки ${tag}`);
  } finally {
    await db.from("events").delete().like("title", "E2E-dash %");
  }
});

test("teacher who is also a parent, viewing as parent, sees only parent announcements", async ({ page }) => {
  const owner = (await db.from("profiles").select("id").eq("phone", PHONES.owner).single()).data!.id as string;
  await db.from("announcements").delete().like("title", "E2E-dash %");
  const tag = Date.now().toString(36);
  const { error } = await db
    .from("announcements")
    .insert({ kindergarten_id: S.A, author_id: owner, audience: "staff", title: `E2E-dash Для сотрудников ${tag}`, body: "", important: true });
  if (error) throw new Error(error.message);
  try {
    await login(page, PHONES.teacherParent);
    await switchContext(page, "Happy Steps E2E", "Родитель");
    await page.goto("/announcements");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(`Для сотрудников ${tag}`);
    await switchContext(page, "Happy Steps E2E", "Воспитатель");
    await page.goto("/announcements");
    await expect(page.locator("main")).toContainText(`Для сотрудников ${tag}`);
  } finally {
    await db.from("announcements").delete().like("title", "E2E-dash %");
  }
});

test("expiring documents: one «Требует внимания» line, archived staff not counted, their folder still open", async ({ page }) => {
  const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
  const owner = (await db.from("profiles").select("id").eq("phone", PHONES.owner).single()).data!.id as string;
  const in5 = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10);
  const docCount = async () => {
    await page.goto("/");
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    const line = page.locator('[data-testid="attention-item"][data-kind="documents"]');
    return (await line.count()) ? Number(await line.getAttribute("data-count")) : 0;
  };

  // An employee with a document expiring in 5 days.
  const phone = randomPhone();
  const name = `Архивная Документ ${Date.now().toString(36)}`;
  const title = `Медкнижка ${name}`;
  const created = await db.auth.admin.createUser({ email: `${phone.slice(1)}@${domain}`, password: PASSWORD, email_confirm: true });
  expect(created.error).toBeNull();
  const uid = created.data.user!.id;
  expect((await db.from("profiles").insert({ id: uid, full_name: name, phone, activated_at: new Date().toISOString() })).error).toBeNull();
  expect((await db.from("memberships").insert({ user_id: uid, kindergarten_id: S.A, role: "cook", consent_at: new Date().toISOString() })).error).toBeNull();
  const doc = await db.from("staff_documents").insert({
    kindergarten_id: S.A,
    user_id: uid,
    type: "med_book",
    title,
    expires_on: in5,
    path: `${S.A}/${uid}/${crypto.randomUUID()}.pdf`,
    mime: "application/pdf",
    size: 100,
    uploaded_by: owner,
  });
  expect(doc.error).toBeNull();

  try {
    await login(page, PHONES.head);
    const before = await docCount();
    expect(before).toBeGreaterThanOrEqual(1);
    // no separate «Истекающие документы» card next to the line
    await expect(page.getByTestId("expiring-documents")).toHaveCount(0);
    await page.goto("/documents?tab=staff&filter=expiring");
    await expect(page.getByTestId("staff-documents")).toContainText(title);

    // Archived: gone from the line, the card and the «истекают» list; the folder keeps the document.
    await db.from("memberships").update({ status: "archived", archived_at: new Date().toISOString() }).eq("user_id", uid).eq("kindergarten_id", S.A);
    expect(await docCount()).toBe(before - 1);
    await page.goto("/documents?tab=staff&filter=expiring");
    await expect(page.getByTestId("staff-documents")).toBeVisible();
    await expect(page.getByTestId("staff-documents")).not.toContainText(title);
    await page.goto(`/documents/staff/${uid}`);
    await expect(page.getByTestId(`staff-folder-${uid}`)).toContainText(title);
  } finally {
    await db.from("staff_documents").delete().eq("user_id", uid);
    await db.from("memberships").delete().eq("user_id", uid);
    await db.auth.admin.deleteUser(uid);
  }
});

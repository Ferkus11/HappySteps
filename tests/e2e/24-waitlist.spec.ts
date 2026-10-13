import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Pool } from "pg";
import { PHONES, acceptInvite, expectToast, fillPhone, login, randomPhone } from "./helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const pg = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RUN = Date.now().toString(36).slice(-5);
const CHILD = `Очередин Айдос ${RUN}`;
const PARENT = `Очередина Мадина ${RUN}`;
const PARENT_PHONE = randomPhone();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const inDays = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Removes everything this spec creates, so it can run again on the same database (and other suites keep their counts). */
async function cleanup() {
  const kids = await pg.query("select id from children where full_name like 'Очередин %'");
  const ids = kids.rows.map((r) => r.id);
  if (ids.length) {
    await pg.query("delete from invoices where child_id = any($1)", [ids]);
    await pg.query("delete from children where id = any($1)", [ids]);
  }
  const parents = await pg.query("select id from profiles where full_name like 'Очередина %'");
  for (const p of parents.rows) await service.auth.admin.deleteUser(p.id);
  await pg.query("delete from waitlist_applications where child_name like 'Очередин %' or child_name like 'Спамов %' or child_name like 'Звонков %' or child_name like 'Лимитов %'");
  await pg.query("delete from notifications where type = 'waitlist.new'");
  await pg.query("delete from waitlist_rate_limits");
}

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  await pg.end();
});

async function fillApplication(page: Page, child: string, parent: string, phone: string) {
  await page.getByTestId("wl-child-name").fill(child);
  await page.getByTestId("wl-child-birth").fill("2022-03-15");
  await page.getByTestId("wl-parent-name").fill(parent);
  await fillPhone(page, /Телефон родителя/, phone);
  await page.getByTestId("wl-desired").fill(inDays(20));
}

test("scenario 7: public application → «Принять» → the child and the parent with an invite appear", async ({ page }) => {
  // 1. A parent fills in the public form — no login.
  await page.context().clearCookies();
  await page.goto("/apply/e2e-a");
  await expect(page.getByTestId("apply-garden")).toHaveText("Happy Steps E2E");
  await fillApplication(page, CHILD, PARENT, PARENT_PHONE);
  await page.getByTestId("wl-comment").fill("Аллергия на цитрусовые");
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-thanks")).toBeVisible();

  // The administration is notified.
  const notes = await pg.query(
    "select p.phone from notifications n join profiles p on p.id = n.user_id where n.type = 'waitlist.new' and n.params->>'child' = $1 order by 1",
    [CHILD],
  );
  expect(notes.rows.map((r) => r.phone)).toEqual([PHONES.owner, PHONES.head].sort());

  // 2. The head sees it in the waitlist and accepts it into Солнышко.
  await login(page, PHONES.head);
  await page.goto("/waitlist");
  const row = page.getByTestId("wl-row").filter({ hasText: CHILD });
  await expect(row.getByTestId("wl-status")).toHaveText("Новая");
  await row.click();
  await expect(page.getByTestId("wl-title")).toHaveText(CHILD);
  await page.getByTestId("wl-accept").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("wl-accept-enrolled")).toHaveValue(inDays(20));
  await dialog.getByTestId("wl-accept-group").selectOption({ label: (await dialog.locator("option", { hasText: "Солнышко" }).innerText()).trim() });
  await dialog.getByTestId("wl-accept-submit").click();
  await expect(dialog.getByTestId("wl-accepted")).toBeVisible();
  const inviteUrl = (await dialog.getByTestId("invite-url").innerText()).trim();
  expect(inviteUrl).toContain("/invite/");

  // Exactly one child card, in Солнышко, with the parent linked; the application is «Принята».
  const kids = await pg.query(
    "select c.id, g.name as group_name, c.enrolled_on::text, (select count(*)::int from child_guardians cg join profiles p on p.id = cg.user_id where cg.child_id = c.id and p.phone = $2) as guardians from children c join groups g on g.id = c.group_id where c.full_name = $1",
    [CHILD, PARENT_PHONE],
  );
  expect(kids.rows).toEqual([{ id: expect.any(String), group_name: "Солнышко", enrolled_on: inDays(20), guardians: 1 }]);
  const app = await pg.query("select status, child_id from waitlist_applications where child_name = $1", [CHILD]);
  expect(app.rows).toEqual([{ status: "accepted", child_id: kids.rows[0].id }]);
  const audit = await pg.query("select 1 from audit_log where action = 'waitlist.accept' and entity_id = (select id::text from waitlist_applications where child_name = $1)", [CHILD]);
  expect(audit.rowCount).toBe(1);

  await dialog.getByTestId("wl-open-child").click();
  await expect(page.getByTestId("child-name")).toHaveText(CHILD);
  await expect(page.getByText(PARENT)).toBeVisible();

  // The application page now links to the child.
  await page.goBack();
  await page.reload();
  await expect(page.getByTestId("wl-accepted-card")).toBeVisible();
  await expect(page.getByTestId("wl-accept")).toHaveCount(0);

  // 3. The parent opens the invite, sets a password and sees the child.
  await acceptInvite(page, inviteUrl);
  await expect(page.getByText(CHILD.split(" ")[1]).first()).toBeVisible();
});

test("«Принять» that fails half-way leaves nothing behind and can be retried", async ({ page }) => {
  const child = `Очередин Откат ${RUN}`;
  const phone = randomPhone();
  const id = (
    await pg.query(
      `insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, source, created_by)
       select id, $1, '2022-02-02', 'Очередина Откат', $2, 'public', null from kindergartens where slug = 'e2e-a' returning id`,
      [child, phone],
    )
  ).rows[0].id;
  const foreignGroup = (await pg.query("select g.id from groups g join kindergartens k on k.id = g.kindergarten_id where k.slug = 'e2e-b' limit 1")).rows[0].id;

  await login(page, PHONES.head);
  await page.goto(`/waitlist/${id}`);
  await page.getByTestId("wl-accept").click();
  const dialog = page.getByRole("dialog");
  // A forged request: a group of another garden. The parent's account is created first, then the database refuses.
  await dialog.getByTestId("wl-accept-group").evaluate((el, gid) => {
    const o = document.createElement("option");
    o.value = gid;
    o.textContent = "forged";
    el.appendChild(o);
    (el as HTMLSelectElement).value = gid;
  }, foreignGroup);
  await dialog.getByTestId("wl-accept-submit").click();
  await expectToast(page, "Недостаточно прав");

  // Nothing is left: no child, no parent account, no membership, the claim is released.
  expect((await pg.query("select 1 from children where full_name = $1", [child])).rowCount).toBe(0);
  expect((await pg.query("select 1 from profiles where phone = $1", [phone])).rowCount).toBe(0);
  const app = await pg.query("select status, accepting_since, accepting_token from waitlist_applications where id = $1", [id]);
  expect(app.rows).toEqual([{ status: "new", accepting_since: null, accepting_token: null }]);

  // The real accept right after works and creates exactly one child and one parent.
  await dialog.getByTestId("wl-accept-group").selectOption({ label: (await dialog.locator("option", { hasText: "Солнышко" }).innerText()).trim() });
  await dialog.getByTestId("wl-accept-submit").click();
  await expect(dialog.getByTestId("wl-accepted")).toBeVisible();
  expect((await pg.query("select 1 from children where full_name = $1", [child])).rowCount).toBe(1);
  const parent = await pg.query(
    "select (select count(*)::int from memberships m where m.user_id = p.id and m.role = 'parent' and m.status = 'active') as memberships from profiles p where p.phone = $1",
    [phone],
  );
  expect(parent.rows).toEqual([{ memberships: 1 }]);
});

test("public form rate limit: per IP per garden, keyed on the trusted proxy hop (first X-Forwarded-For entry is ignored)", async ({ page }) => {
  await pg.query("delete from waitlist_rate_limits");
  await page.context().clearCookies();
  const send = async (n: number, realIp: string) => {
    // A client rotating the first entry: with one trusted proxy only the last entry (added by it) counts.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `6.6.6.${n}, ${realIp}` });
    await page.goto("/apply/e2e-a");
    await page.getByTestId("wl-child-name").fill(`Лимитов Тимур ${n} ${RUN}`);
    await page.getByTestId("wl-child-birth").fill("2022-03-15");
    await page.getByTestId("wl-parent-name").fill("Лимитова Мама");
    await fillPhone(page, /Телефон родителя/, randomPhone());
    await page.getByTestId("apply-submit").click();
  };
  for (let n = 1; n <= 10; n++) {
    await send(n, "10.20.30.40");
    await expect(page.getByTestId("apply-thanks")).toBeVisible();
  }
  await send(11, "10.20.30.40");
  await expect(page.getByTestId("apply-error")).toContainText("Слишком много заявок");
  await expect(page.getByTestId("apply-thanks")).toHaveCount(0);
  // Another client (another proxy-seen IP) is not affected.
  await send(12, "10.20.30.41");
  await expect(page.getByTestId("apply-thanks")).toBeVisible();
  await page.setExtraHTTPHeaders({});
  await pg.query("delete from waitlist_rate_limits");
});

test("the public form: validation, honeypot, unknown garden, Kazakh", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/apply/e2e-a");
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-error")).toHaveText("Проверьте правильность заполнения.");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(page.getByTestId("apply-thanks")).toHaveCount(0);

  // A bot fills the hidden field: it is told «thank you», nothing is stored.
  await fillApplication(page, `Спамов Бот ${RUN}`, "Спамов Робот", randomPhone());
  await page.getByTestId("apply-website").evaluate((el) => {
    (el as HTMLInputElement).value = "https://spam.example";
  });
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-thanks")).toBeVisible();
  expect((await pg.query("select 1 from waitlist_applications where child_name like 'Спамов %'")).rowCount).toBe(0);

  const res = await page.goto("/apply/no-such-garden");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("apply-not-found")).toBeVisible();

  await page.goto("/apply/e2e-a");
  await page.getByTestId("language-switcher").click();
  await page.getByTestId("locale-kk").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Балабақшаға өтінім");
  await expect(page.getByTestId("apply-submit")).toHaveText("Өтінім жіберу");
  await page.context().clearCookies();
});

test("head: manual application, «Связались», comment; owner dashboard widget", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/waitlist");
  await page.getByTestId("wl-add").click();
  await fillApplication(page, `Звонков Ерлан ${RUN}`, "Звонкова Айжан", randomPhone());
  await page.getByTestId("wl-add-submit").click();
  await expectToast(page, "Заявка добавлена");
  await expect(page.getByTestId("wl-title")).toHaveText(`Звонков Ерлан ${RUN}`);
  await page.getByTestId("wl-set-contacted").click();
  await expectToast(page, "Статус изменён");
  await expect(page.getByTestId("wl-status")).toHaveText("Связались");
  await page.getByTestId("wl-comment-input").fill("Ждут место с января");
  await page.getByTestId("wl-comment-submit").click();
  await expect(page.getByTestId("wl-comment").filter({ hasText: "Ждут место с января" })).toBeVisible();
  await expect(page.getByTestId("wl-timeline")).toContainText("Статус: Связались");

  const waiting = Number((await pg.query("select count(*) from waitlist_applications w join kindergartens k on k.id = w.kindergarten_id where k.slug = 'e2e-a' and w.status in ('new','contacted')")).rows[0].count);
  await login(page, PHONES.owner);
  const widget = page.getByTestId("waitlist-widget");
  await expect(widget.getByTestId("waitlist-waiting")).toHaveText(String(waiting));
  await widget.getByTestId("waitlist-widget-row").filter({ hasText: `Звонков Ерлан ${RUN}` }).click();
  await expect(page.getByTestId("wl-title")).toHaveText(`Звонков Ерлан ${RUN}`);
});

test("accountant reads only; teacher and parent have no access", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto("/waitlist");
  await expect(page.getByTestId("wl-row").first()).toBeVisible();
  await expect(page.getByTestId("wl-add")).toHaveCount(0);
  await page.getByTestId("wl-row").first().click();
  await expect(page.getByTestId("wl-title")).toBeVisible();
  await expect(page.getByTestId("wl-accept")).toHaveCount(0);
  await expect(page.getByTestId("wl-comment-input")).toHaveCount(0);

  for (const phone of [PHONES.teacher, PHONES.parent]) {
    await login(page, phone);
    await expect(page.locator('a[href="/waitlist"]')).toHaveCount(0);
    await page.goto("/waitlist");
    await expect(page).toHaveURL((u) => u.pathname === "/");
  }
});

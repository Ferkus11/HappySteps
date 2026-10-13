import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { config } from "dotenv";
import { Pool } from "pg";
import { PHONES, login } from "./helpers";
import { russianDenyList, russianOnScreen } from "./kk-scan";
import { navFor } from "../../src/lib/nav";
import type { AnyRole } from "../../src/lib/auth/roles";

/**
 * SPEC §13 scenario 12: after switching to Kazakh, no screen of the current role shows Russian strings.
 * For every role: switch with the header switcher (no page reload — the same document keeps its state), then open
 * every menu destination, the detail pages linked from them, profile, notifications and the main dialogs.
 * User content (names, titles, messages — `data-user-content`) is not translated and is skipped.
 * Ends by switching back to Russian with the same switcher, so the profile language is left as it was.
 */

test.setTimeout(300_000);

const deny = russianDenyList();

config({ path: ".env.local", quiet: true });

// Re-runnable: whatever happens above, the fixture users end in Russian (push texts follow the profile language).
test.afterAll(async () => {
  const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
  try {
    await db.query("update profiles set locale = 'ru' where phone = any($1)", [Object.values(PHONES)]);
  } finally {
    await db.end();
  }
});

const ROLES: { role: AnyRole; phone: string; extra: string[]; dialogs: [path: string, testId: string][] }[] = [
  {
    role: "owner",
    phone: PHONES.owner,
    extra: ["/profile", "/notifications", "/search?q=%D0%B0", "/worktime/timesheet", "/attendance/report", "/payments?tab=month", "/payments?tab=debtors", "/documents?tab=staff", "/menu/edit"],
    dialogs: [
      ["/staff", "add-staff"],
      ["/groups", "add-group"],
      ["/children", "add-child"],
      ["/announcements", "new-announcement"],
      ["/events", "new-event"],
      ["/waitlist", "wl-add"],
      ["/clubs", "add-club"],
      ["/chats", "new-chat"],
    ],
  },
  {
    role: "head",
    phone: PHONES.head,
    extra: ["/profile", "/notifications", "/worktime/timesheet", "/attendance/report", "/menu/edit"],
    dialogs: [
      ["/children", "add-child"],
      ["/announcements", "new-announcement"],
      ["/events", "new-event"],
    ],
  },
  {
    role: "accountant",
    phone: PHONES.accountant,
    extra: ["/profile", "/notifications", "/worktime/timesheet", "/payments?tab=month", "/payments?tab=debtors"],
    dialogs: [["/chats", "new-chat"]],
  },
  {
    role: "teacher",
    phone: PHONES.teacher,
    extra: ["/profile", "/notifications"],
    dialogs: [
      ["/announcements", "new-announcement"],
      ["/chats", "new-chat"],
    ],
  },
  { role: "club_teacher", phone: PHONES.clubTeacher, extra: ["/profile", "/notifications"], dialogs: [["/chats", "new-chat"]] },
  { role: "cook", phone: PHONES.cook, extra: ["/profile", "/notifications", "/menu/edit"], dialogs: [] },
  {
    role: "parent",
    phone: PHONES.parent,
    extra: ["/profile", "/notifications"],
    dialogs: [
      ["/", "report-absence"],
      ["/chats", "new-chat"],
    ],
  },
  { role: "superadmin", phone: PHONES.superadmin, extra: ["/profile"], dialogs: [["/admin", "create-kg"]] },
];

/** Waits for the streamed page: no skeletons left. */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await expect(page.locator("[data-skeleton]")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(150);
}

async function switchLanguage(page: Page, locale: "ru" | "kk") {
  await page.getByTestId("language-switcher").click();
  await page.getByTestId(`locale-${locale}`).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByTestId("language-switcher")).toContainText(locale);
}

/** Pattern of a link, for visiting one page of each kind: ids → ":id", query keys kept. */
function pattern(href: string) {
  const u = new URL(href, "http://x");
  const keys = [...u.searchParams.keys()].sort().join("&");
  return u.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id") + (keys ? `?${keys}` : "");
}

const SKIP_LINK = /\/export|\/file\/|\/open$|^\/apply\/|^\/login|^\/styleguide|\/notifications\/[^/]+\/open/;

for (const r of ROLES) {
  test(`scenario 12 · ${r.role}: every screen in Kazakh, no Russian strings`, async ({ page }) => {
    const problems: string[] = [];
    const check = async (where: string, scope?: string, withTitle = true) => {
      for (const p of await russianOnScreen(page, deny, scope, withTitle)) problems.push(`${where} — ${p}`);
    };

    await login(page, r.phone);
    await page.goto(r.role === "superadmin" ? "/admin" : "/");
    await settle(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    // The switch happens in place: the same document (window marker survives), same URL, no data reload.
    const url = page.url();
    await page.evaluate(() => ((window as unknown as { __hsSameDocument: boolean }).__hsSameDocument = true));
    await switchLanguage(page, "kk");
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => (window as unknown as { __hsSameDocument?: boolean }).__hsSameDocument)).toBe(true);
    await settle(page);
    await check(url);

    // Menu destinations, then one page of each kind linked from them.
    const nav = navFor(r.role).all.map((i) => i.href);
    const seen = new Set<string>([...nav, ...r.extra].map(pattern));
    const queue = [...nav, ...r.extra];
    const details: string[] = [];
    for (const path of queue) {
      await page.goto(path);
      await settle(page);
      await check(path);
      if (!nav.includes(path)) continue;
      const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      for (const h of hrefs) {
        if (!h || SKIP_LINK.test(h)) continue;
        const key = pattern(h);
        if (seen.has(key) || details.length >= 25) continue;
        seen.add(key);
        details.push(h);
      }
    }
    for (const path of details) {
      await page.goto(path);
      await settle(page);
      await check(path, undefined, false);
    }

    // Dialogs.
    for (const [path, id] of r.dialogs) {
      await page.goto(path);
      await settle(page);
      const trigger = page.getByTestId(id).first();
      if (!(await trigger.isVisible())) continue;
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(200);
      await check(`${path} [${id}]`, "[role=dialog]");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // Phone layout: the bottom bar and its «More» sheet.
    if (r.role !== "superadmin") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await settle(page);
      await check("/ (390)", "[data-testid=bottom-nav]");
      const more = page.getByTestId("bottom-nav").locator("button");
      if (await more.isVisible()) {
        await more.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await check("/ (390) more", "[role=dialog]");
        await page.keyboard.press("Escape");
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await settle(page);
    }

    // The account menu (profile link, context switcher, logout).
    await page.getByTestId("account-menu").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await check("account menu", "[role=menu]");
    await page.keyboard.press("Escape");

    expect(problems, `Russian strings on Kazakh screens:\n${problems.join("\n")}`).toEqual([]);

    // Back to Russian with the same switcher (the language is stored in the profile too).
    await switchLanguage(page, "ru");
    await expect(page.locator("main")).toBeVisible();
  });
}

test("scenario 12 · exports follow the reader's language", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.goto("/");
  await switchLanguage(page, "kk");
  const sheet = async (url: string) => {
    const res = await page.request.get(url);
    expect(res.status()).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
    return wb.worksheets[0];
  };
  const ts = await sheet("/worktime/timesheet/export?format=xlsx");
  expect(ts.getCell(1, 1).value).toBe("Жұмыс уақыты табелі");
  const pay = await sheet("/payments/export");
  expect(pay.name).toBe("Шоттар");
  await switchLanguage(page, "ru");
  const tsRu = await sheet("/worktime/timesheet/export?format=xlsx");
  expect(tsRu.getCell(1, 1).value).toBe("Табель");
});

test("scenario 12 · ru → kk → ru keeps the page and what was typed", async ({ page }) => {
  await login(page, PHONES.owner);
  await page.goto("/children");
  await settle(page);
  const title = page.locator("h1").first();
  await expect(title).toHaveText("Дети");
  const search = page.getByRole("search").getByRole("textbox");
  await search.fill("Алихан");
  await page.evaluate(() => ((window as unknown as { __hsSameDocument: boolean }).__hsSameDocument = true));

  await switchLanguage(page, "kk");
  await expect(title).toHaveText("Балалар");
  await expect(page.getByTestId("sidebar-column")).toContainText("Басты бет");
  await expect(search).toHaveValue("Алихан");

  await switchLanguage(page, "ru");
  await expect(title).toHaveText("Дети");
  await expect(page.getByTestId("sidebar-column")).toContainText("Главная");
  await expect(search).toHaveValue("Алихан");
  expect(new URL(page.url()).pathname).toBe("/children");
  expect(await page.evaluate(() => (window as unknown as { __hsSameDocument?: boolean }).__hsSameDocument)).toBe(true);
});

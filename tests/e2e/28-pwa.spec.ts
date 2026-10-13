import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PHONES, expectToast, login } from "./helpers";

// The service worker is blocked for every other spec (playwright.config.ts); this one opts in.
test.use({ serviceWorkers: "allow" });

// Chromium doesn't apply context.setOffline() to service workers unless Playwright manages their network
// (read when a worker starts, so it is set only around this file).
const SW_NET = "PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS";
test.beforeAll(() => {
  process.env[SW_NET] = "1";
});
test.afterAll(() => {
  delete process.env[SW_NET];
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Waits until the worker controls the page (it claims clients when it activates). */
async function waitForWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !!navigator.serviceWorker.controller;
  }, undefined, { timeout: 20_000 });
}

/** Paths saved in the personal page cache (hs-pages-*). */
async function cachedPages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("hs-pages-")) continue;
      const c = await caches.open(name);
      for (const r of await c.keys()) out.push(new URL(r.url).pathname);
    }
    return out;
  });
}

/**
 * No network for the page and its service worker. setOffline alone is not reliably applied to the worker's
 * own fetches in Chromium, so requests are also aborted the way a dropped connection fails them.
 */
async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route("**/*", (r) => r.abort("internetdisconnected"));
}

async function goOnline(context: BrowserContext) {
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.setOffline(false);
}

async function waitForCached(page: Page, path: string) {
  await expect.poll(() => cachedPages(page), { timeout: 15_000 }).toContain(path);
}

test("manifest is served, valid and its icons are reachable", async ({ page, request }) => {
  await page.goto("/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");

  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: "Happy Steps", display: "standalone", start_url: "/", lang: "ru" });
  expect(m.short_name).toBeTruthy();
  expect(m.theme_color).toMatch(/^#/);
  const icons = [...m.icons, { src: appleIcon, sizes: "180x180" }] as { src: string; sizes: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
  for (const icon of icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toBe("image/png");
    const png = await r.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }

  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["service-worker-allowed"]).toBe("/");
  expect(await sw.text()).toMatch(/^[\s\S]*?importScripts\("\/sw-push\.js"\)/);
  expect((await request.get("/sw-push.js")).ok()).toBe(true);
});

test("offline: banner, saved pages, /offline for unvisited pages, actions blocked", async ({ page, context }) => {
  await login(page, PHONES.parent);
  await waitForWorker(page);
  await page.goto("/profile");
  await expect(page.getByTestId("pwa-app-section")).toBeVisible();
  await waitForCached(page, "/profile");

  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });

  await goOffline(context);
  await expect(page.getByTestId("offline-banner")).toHaveText("Нет подключения — данные только для просмотра");

  // A mutation is not sent: one clear message instead of a spinner.
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expectToast(page, "Нет подключения к интернету. Действие недоступно.");
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);

  // A page opened before renders from the saved copy (read-only).
  const saved = await page.goto("/profile");
  expect(saved?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByTestId("account-menu")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toBeVisible();

  // A page never opened on this device: the friendly offline page.
  await page.goto("/payments");
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Нет подключения к интернету" })).toBeVisible();
  await expect(page.getByTestId("offline-retry")).toBeVisible();

  // «Повторить» without network: still the offline page, same address.
  await page.getByTestId("offline-retry").click();
  await expect(page.getByTestId("offline-retry")).toHaveText(/Повторить/);
  await expect(page).toHaveURL(/\/payments$/);

  // Back online: the requested page opens by itself.
  await goOnline(context);
  await expect(page.getByTestId("offline-page")).toHaveCount(0);
  await expect(page.getByTestId("account-menu")).toBeVisible();
  await expect(page).toHaveURL(/\/payments$/);
});

test("server unreachable while the device reports online: same banner and message", async ({ page, context }) => {
  await login(page, PHONES.parent);
  await page.goto("/profile");
  await expect(page.getByTestId("pwa-app-section")).toBeVisible();
  await context.route("**/*", (r) => r.abort("connectionrefused"));
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expectToast(page, "Нет подключения к интернету. Действие недоступно.");
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  // The app checks the connection in the background and drops the banner once the server answers again.
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByTestId("offline-banner")).toHaveCount(0, { timeout: 15_000 });
});

test("server unreachable while the device reports online: a page from the saved copy shows the banner", async ({ page, context }) => {
  await login(page, PHONES.parent);
  await waitForWorker(page);
  await page.goto("/profile");
  await expect(page.getByTestId("pwa-app-section")).toBeVisible();
  await waitForCached(page, "/profile");
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);

  // No setOffline: the browser still thinks it is online, only the server does not answer.
  await context.route("**/*", (r) => r.abort("connectionrefused"));
  const saved = await page.goto("/profile");
  expect(saved?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toHaveText("Нет подключения — данные только для просмотра");

  await context.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByTestId("offline-banner")).toHaveCount(0, { timeout: 15_000 });
});

test("saved pages are dropped when the garden/role changes behind the app's back (e.g. a push click)", async ({ page, context }) => {
  await login(page, PHONES.teacherParent);
  await waitForWorker(page);
  await page.goto("/notifications");
  await waitForCached(page, "/notifications");
  await page.goto("/profile");
  await waitForCached(page, "/profile");

  // What /notifications/<id>/open does for a notification of another garden: the server switches the context cookie.
  const shown = (await page.locator("[data-hs-context]").getAttribute("data-hs-context")) ?? "";
  const [kg, role] = shown.split("|")[1].split(":");
  await context.addCookies([{ name: "hs_ctx", value: `${kg}:${role === "parent" ? "teacher" : "parent"}`, url: page.url(), httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/");
  await expect(page.locator("[data-hs-context]")).not.toHaveAttribute("data-hs-context", shown);
  await expect.poll(() => cachedPages(page)).not.toContain("/notifications");
  expect(await cachedPages(page)).not.toContain("/profile");
});

test("the offline page speaks Russian and Kazakh", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Нет подключения к интернету" })).toBeVisible();
  await expect(page.getByTestId("offline-page-kk")).toContainText("Интернет байланысы жоқ");
  await expect(page.getByTestId("offline-retry")).toHaveText(/Повторить · Қайталау/);
});

test("a new version offers «Обновить» and takes over after the tap", async ({ page }) => {
  await login(page, PHONES.parent);
  await waitForWorker(page);
  // A different script URL for the same scope is installed as an update and waits, like a new deploy.
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js?update-test=1", { scope: "/" }));
  await expectToast(page, "Доступна новая версия");
  await page.getByRole("button", { name: "Обновить" }).click();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes("update-test=1"), undefined, { timeout: 20_000 });
  await expect(page.getByTestId("account-menu")).toBeVisible();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Доступна новая версия" })).toHaveCount(0);
});

test("logout clears the saved pages", async ({ page }) => {
  await login(page, PHONES.parent);
  await waitForWorker(page);
  await page.goto("/profile");
  await waitForCached(page, "/profile");
  await page.getByTestId("account-menu").click();
  await page.getByTestId("logout").click();
  await page.waitForURL(/\/login$/);
  await expect.poll(() => cachedPages(page)).toEqual([]);
});

test.describe("iPhone in Safari", () => {
  test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("parent sees the «Add to Home Screen» steps once; dismissal is remembered", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => false, configurable: true }));
    await login(page, PHONES.parent);
    const sheet = page.getByTestId("ios-install-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Установите приложение" })).toBeVisible();
    await expect(page.getByTestId("ios-install-steps").locator("li")).toHaveCount(3);
    await page.getByTestId("ios-install-dismiss").click();
    await expect(sheet).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("account-menu")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(sheet).toHaveCount(0);

    // Still available later from the profile.
    await page.goto("/profile");
    await expect(page.getByTestId("pwa-app-section").getByTestId("ios-install-steps")).toBeVisible();
  });

  test("hidden in the installed app (standalone)", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true }));
    await login(page, PHONES.parent);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("ios-install-sheet")).toHaveCount(0);
    await page.goto("/profile");
    await expect(page.getByTestId("pwa-installed")).toBeVisible();
  });

  test("not shown to staff", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => false, configurable: true }));
    await login(page, PHONES.teacher);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("ios-install-sheet")).toHaveCount(0);
  });
});

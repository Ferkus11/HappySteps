import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

const STAGE = "stage6";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.use({ serviceWorkers: "allow" });
const SW_NET = "PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS";
test.beforeAll(() => {
  process.env[SW_NET] = "1"; // lets the offline emulation reach the service worker (see tests/e2e/28-pwa.spec.ts)
});
test.afterAll(() => {
  delete process.env[SW_NET];
});

async function setLocale(page: Page, locale: "ru" | "kk") {
  await page.context().addCookies([{ name: "hs_locale", value: locale, url: new URL(page.url()).origin }]);
}

async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route("**/*", (r) => r.abort("internetdisconnected"));
}

async function waitForWorker(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 20_000 });
}

for (const locale of ["ru", "kk"] as const) {
  test(`offline banner and /offline page · ${locale}`, async ({ page, context }) => {
    await login(page, PHONES.parent);
    await setLocale(page, locale);
    await page.goto("/");
    await waitForWorker(page);
    // Re-install the worker so the precached /offline page is in this locale.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.unregister();
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    });
    await page.reload();
    await waitForWorker(page);
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    await goOffline(context);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await snap(page, STAGE, `pwa-offline-banner-${locale}`);
    await page.goto("/clubs");
    await expect(page.getByTestId("offline-page")).toBeVisible();
    await snap(page, STAGE, `pwa-offline-page-${locale}`);
  });

  test(`blocked action toast · ${locale}`, async ({ page, context }) => {
    await login(page, PHONES.parent);
    await setLocale(page, locale);
    await page.goto("/profile");
    await expect(page.getByTestId("pwa-app-section")).toBeVisible();
    await goOffline(context);
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();
    await page.waitForTimeout(500); // let the toast finish its fade-in, or the capture shows it half transparent
    await snap(page, STAGE, `pwa-offline-action-${locale}`);
  });

  test(`update toast · ${locale}`, async ({ page }) => {
    await login(page, PHONES.owner);
    await setLocale(page, locale);
    await page.goto("/");
    await waitForWorker(page);
    await page.evaluate(() => navigator.serviceWorker.register(`/sw.js?update-test=${Date.now()}`, { scope: "/" }));
    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    await snap(page, STAGE, `pwa-update-toast-${locale}`);
  });

  test(`install button in the profile · ${locale}`, async ({ page }) => {
    await login(page, PHONES.parent);
    await setLocale(page, locale);
    await page.goto("/profile");
    await expect(page.getByTestId("pwa-app-section")).toBeVisible();
    // Chromium's install prompt (headless never fires it on its own).
    await page.evaluate(() => {
      const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => undefined,
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(e);
    });
    await expect(page.getByTestId("pwa-install")).toBeVisible();
    await snap(page, STAGE, `pwa-profile-install-${locale}`);
  });
}

test.describe("iPhone", () => {
  test.use({ userAgent: IPHONE_UA, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  for (const locale of ["ru", "kk"] as const) {
    test(`iOS install sheet and profile steps · ${locale}`, async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => false, configurable: true }));
      await login(page, PHONES.parent);
      await setLocale(page, locale);
      await page.goto("/");
      await expect(page.getByTestId("ios-install-sheet")).toBeVisible();
      await page.waitForTimeout(400);
      await snap(page, STAGE, `pwa-ios-sheet-${locale}`);
      await page.getByTestId("ios-install-dismiss").click();
      await page.goto("/profile");
      await expect(page.getByTestId("pwa-app-section").getByTestId("ios-install-steps")).toBeVisible();
      await snap(page, STAGE, `pwa-profile-ios-${locale}`);
    });
  }
});

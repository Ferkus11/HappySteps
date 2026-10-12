import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Test1234!";
export const PHONES = {
  superadmin: "+77000000001",
  owner: "+77010000001",
  head: "+77010000002",
  accountant: "+77010000003",
  teacher: "+77010000004",
  clubTeacher: "+77010000005",
  cook: "+77010000006",
  parent: "+77010000007",
  teacherParent: "+77010000008",
  ownerB: "+77020000001",
  parentB: "+77020000002",
} as const;

/** Random KZ mobile number for data created by a test run. */
export function randomPhone() {
  return `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

export function digits(phone: string) {
  return phone.replace(/^\+7/, "");
}

export async function login(page: Page, phone: string, password = PASSWORD) {
  await page.context().clearCookies();
  await page.goto("/login");
  const input = page.getByLabel("Номер телефона");
  await input.click();
  await input.pressSequentially(digits(phone));
  await page.getByLabel("Пароль").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await acceptConsentIfAsked(page);
}

export async function acceptConsentIfAsked(page: Page) {
  // Settle on either the consent screen or a page of the app.
  await page
    .locator('[data-testid="consent-checkbox"], [data-testid="account-menu"], [data-testid="no-access-logout"]')
    .first()
    .waitFor({ state: "visible" });
  if (page.url().includes("/consent")) {
    await page.getByTestId("consent-checkbox").click();
    await page.getByTestId("consent-continue").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/consent"));
  }
}

/** Opens an invite link, sets a password and lands in the app. */
export async function acceptInvite(page: Page, url: string, password = PASSWORD) {
  await page.context().clearCookies();
  await page.goto(new URL(url).pathname);
  await page.getByLabel("Новый пароль").fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByTestId("invite-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/invite"));
  await acceptConsentIfAsked(page);
}

export async function fillPhone(page: Page, label: string | RegExp, phone: string) {
  const input = page.getByLabel(label);
  await input.click();
  await input.pressSequentially(digits(phone));
}

export async function switchContext(page: Page, kgName: string, roleLabel: string) {
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem").filter({ hasText: kgName }).filter({ hasText: roleLabel }).click();
  await expect(page.getByTestId("account-menu")).toContainText(roleLabel);
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

import { expect, test } from "@playwright/test";

test("anonymous visitor is sent to the login page (ru by default)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
  await expect(page.getByText("Забыли пароль? Обратитесь к администрации сада.")).toBeVisible();
});

test("language switch to Kazakh keeps the page and translates it", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("language-switcher").click();
  await page.getByTestId("locale-kk").click();
  await expect(page.getByRole("heading", { name: "Кіру" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "kk");
  await page.getByTestId("language-switcher").click();
  await page.getByTestId("locale-ru").click();
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
});

test("phone input applies the +7 mask", async ({ page }) => {
  await page.goto("/login");
  const phone = page.getByLabel("Номер телефона");
  await phone.click();
  await phone.pressSequentially("7011234567");
  await expect(phone).toHaveValue("+7 (701) 123-45-67");
});

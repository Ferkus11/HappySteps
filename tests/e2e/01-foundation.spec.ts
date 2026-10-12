import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PASSWORD, PHONES, acceptInvite, fillPhone, login, randomPhone, switchContext } from "./helpers";

config({ path: ".env.local" });

test.describe.configure({ mode: "serial" });

test("scenario 1: superadmin → owner → head → group, teacher, child, parent → parent sees child", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const kgName = `Тестовый сад ${suffix}`;
  const ownerPhone = randomPhone();
  const headPhone = randomPhone();
  const teacherPhone = randomPhone();
  const parentPhone = randomPhone();

  // Superadmin creates a kindergarten with its first owner.
  await login(page, PHONES.superadmin);
  await expect(page).toHaveURL(/\/admin/);
  await page.getByTestId("create-kg").click();
  await page.getByLabel("Название сада").fill(kgName);
  await page.getByLabel("Короткий адрес").fill(`t-${suffix}`);
  await page.getByLabel("ФИО владельца").fill("Тестова Владелица Ивановна");
  await fillPhone(page, "Телефон владельца", ownerPhone);
  await page.getByTestId("create-kg-submit").click();
  const ownerLink = await page.getByTestId("invite-url").innerText();
  expect(ownerLink).toContain("/invite/");

  // Owner sets a password and creates the head.
  await acceptInvite(page, ownerLink);
  await expect(page.getByText(kgName).first()).toBeVisible();
  await page.goto("/staff");
  await page.getByTestId("add-staff").click();
  await page.getByLabel("ФИО").fill("Заведующая Тестовая");
  await fillPhone(page, "Телефон", headPhone);
  await page.getByLabel("Роль").selectOption("head");
  await page.getByTestId("add-staff-submit").click();
  const headLink = await page.getByTestId("invite-url").innerText();

  // Head creates a group, a teacher, a child with a parent.
  await acceptInvite(page, headLink);
  await page.goto("/groups");
  await page.getByTestId("add-group").first().click();
  await page.getByLabel("Название").fill("Ромашка");
  await page.getByLabel("Вместимость").fill("15");
  await page.getByTestId("save-group").click();
  await expect(page.getByTestId("group-Ромашка")).toBeVisible();

  await page.goto("/staff");
  await page.getByTestId("add-staff").click();
  await page.getByLabel("ФИО").fill("Воспитатель Тестовый");
  await fillPhone(page, "Телефон", teacherPhone);
  // head cannot pick owner/head/accountant
  await expect(page.getByLabel("Роль").locator("option")).toHaveCount(3);
  await page.getByLabel("Роль").selectOption("teacher");
  await page.getByText("Ромашка").click();
  await page.getByTestId("add-staff-submit").click();
  await expect(page.getByTestId("invite-url")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/children");
  await page.getByTestId("add-child").first().click();
  await page.getByLabel("ФИО ребёнка").fill("Тестов Тимур Аскарович");
  await page.getByLabel("Дата рождения").fill("2021-06-01");
  await page.getByLabel("Оплата в месяц, ₸").fill("60000");
  await page.getByLabel("ФИО родителя").fill("Тестов Аскар Маратович");
  await fillPhone(page, "Телефон родителя", parentPhone);
  await page.getByTestId("add-child-submit").click();
  const parentLink = await page.getByTestId("invite-url").innerText();

  // Parent opens the link and sees the child.
  await acceptInvite(page, parentLink);
  await expect(page.getByTestId("my-child")).toContainText("Тестов Тимур Аскарович");
});

test("duplicate phone: existing person is added, not re-created", async ({ page }) => {
  // Make the test repeatable: remove the membership a previous run created.
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: p } = await service.from("profiles").select("id").eq("phone", PHONES.parentB).single();
  const { data: kgA } = await service.from("kindergartens").select("id").eq("slug", "e2e-a").single();
  await service.from("memberships").delete().eq("user_id", p!.id).eq("kindergarten_id", kgA!.id);
  await login(page, PHONES.owner);
  await page.goto("/staff");
  await page.getByTestId("add-staff").click();
  await page.getByLabel("ФИО").fill("Кто угодно");
  await fillPhone(page, "Телефон", PHONES.parentB); // registered in kindergarten B
  await page.getByLabel("Роль").selectOption("cook");
  await page.getByTestId("add-staff-submit").click();
  await expect(page.getByTestId("already-registered")).toHaveText("Этот человек уже зарегистрирован, добавлен в ваш сад.");
  // Keep the fixtures clean for RLS tests.
  await service.from("memberships").delete().eq("user_id", p!.id).eq("kindergarten_id", kgA!.id);
});

test("scenario 11: a teacher who is also a parent switches roles", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  await switchContext(page, "Happy Steps E2E", "Родитель");
  await expect(page.getByTestId("my-child")).toContainText("Смирнов Миша");
  await switchContext(page, "Happy Steps E2E", "Воспитатель");
  await page.goto("/children");
  await expect(page.getByTestId("child-row")).toHaveCount(1);
  await expect(page.getByTestId("child-row")).toContainText("Бекова Сабина");
  // remembered after re-login
  await login(page, PHONES.teacherParent);
  await page.goto("/children");
  await expect(page.getByTestId("child-row")).toContainText("Бекова Сабина");
});

test("scenario 10: kindergarten A cannot see kindergarten B (UI and API)", async ({ page }) => {
  // UI: B's child URL is a 404 for A's owner
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: bChild } = await service.from("children").select("id").eq("full_name", "Иванов Саша Петрович").single();
  await login(page, PHONES.owner);
  const res = await page.goto(`/children/${bChild!.id}`);
  expect(res?.status()).toBe(404);

  // API: direct REST queries with A owner's JWT return nothing from B
  const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
  const { error } = await api.auth.signInWithPassword({ email: `${PHONES.owner.slice(1)}@${domain}`, password: PASSWORD });
  expect(error).toBeNull();
  const { data: kgB } = await service.from("kindergartens").select("id").eq("slug", "e2e-b").single();
  for (const table of ["children", "groups", "memberships", "child_guardians", "kindergarten_settings", "audit_log"]) {
    const { data } = await api.from(table).select("*").eq("kindergarten_id", kgB!.id);
    expect(data ?? [], table).toEqual([]);
  }
  const { data: kgs } = await api.from("kindergartens").select("slug");
  expect(kgs?.map((k) => k.slug)).toEqual(["e2e-a"]);
});

test("scenario 9 (part 1): an archived teacher cannot get in", async ({ page }) => {
  const phone = randomPhone();
  await login(page, PHONES.owner);
  await page.goto("/staff");
  await page.getByTestId("add-staff").click();
  await page.getByLabel("ФИО").fill("Временный Воспитатель");
  await fillPhone(page, "Телефон", phone);
  await page.getByLabel("Роль").selectOption("teacher");
  await page.getByTestId("add-staff-submit").click();
  const link = await page.getByTestId("invite-url").innerText();
  await acceptInvite(page, link);
  await expect(page).toHaveURL(/\/$/);

  await login(page, PHONES.owner);
  await page.goto("/staff");
  await page.getByTestId(`staff-${phone}`).click();
  await page.getByTestId("archive-person").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByText("В архиве").first()).toBeVisible();

  await login(page, phone);
  await expect(page).toHaveURL(/\/no-access/);
  await expect(page.getByText("Доступ закрыт")).toBeVisible();
});

test("login: wrong password, then rate limit after 5 failures", async ({ page }) => {
  const phone = randomPhone();
  await page.goto("/login");
  for (let i = 0; i < 6; i++) {
    await page.context().clearCookies();
    await page.goto("/login");
    await fillPhone(page, "Номер телефона", phone);
    await page.getByLabel("Пароль").fill("wrong-password");
    await page.getByTestId("login-submit").click();
    await expect(page.locator("p[role=alert]")).toBeVisible();
  }
  await expect(page.locator("p[role=alert]")).toContainText("Слишком много попыток");
});

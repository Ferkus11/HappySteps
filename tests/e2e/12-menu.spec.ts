import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { PASSWORD, PHONES, expectToast, login } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const service = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function almaty(offset = 0) {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const TODAY = almaty();
const TOMORROW = almaty(1);
const DEFAULT_MEALS = ["breakfast", "second_breakfast", "lunch", "snack"];
let kgA = "";

test.beforeAll(async () => {
  // Re-runnable: today/tomorrow start empty, meals are the defaults.
  const db = service();
  const { data } = await db.from("kindergartens").select("id").eq("slug", "e2e-a").single();
  kgA = data!.id;
  await db.from("menus").delete().eq("kindergarten_id", kgA).in("date", [TODAY, TOMORROW]);
  await db.from("kindergarten_settings").update({ meals: DEFAULT_MEALS }).eq("kindergarten_id", kgA);
});

test.afterAll(async () => {
  await service().from("kindergarten_settings").update({ meals: DEFAULT_MEALS }).eq("kindergarten_id", kgA);
});

test("cook fills today's menu with the keyboard → parent sees it on the dashboard and in /menu", async ({ page }) => {
  await login(page, PHONES.cook);
  await expect(page.getByTestId("menu-kitchen-today")).toContainText("Повар ещё не заполнил меню");
  await page.getByTestId("menu-kitchen-edit").click();
  await page.waitForURL(`**/menu/edit?date=${TODAY}`);

  await page.getByTestId("dish-breakfast-0").fill("Каша гречневая E2E");
  await page.keyboard.press("Enter"); // → composition
  await page.keyboard.type("гречка, молоко, масло");
  await page.keyboard.press("Enter"); // → new dish row
  await expect(page.getByTestId("dish-breakfast-1")).toBeFocused();
  await page.keyboard.type("Чай с лимоном");
  await page.getByTestId("dish-lunch-0").fill("Суп с фрикадельками");
  await page.getByTestId("composition-lunch-0").fill("говядина, картофель, морковь");
  await page.keyboard.press("Control+Enter");
  await expectToast(page, "Меню сохранено");
  await expect(page.getByTestId("menu-clear")).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("menu-kitchen-today")).toContainText("Каша гречневая E2E, Чай с лимоном");
  await expect(page.getByTestId("menu-kitchen-tomorrow")).toContainText("Повар ещё не заполнил меню");

  await login(page, PHONES.parent);
  const widget = page.getByTestId("menu-today");
  await expect(widget).toContainText("Завтрак");
  await expect(widget).toContainText("Каша гречневая E2E, Чай с лимоном");
  await expect(widget).toContainText("Суп с фрикадельками");
  await widget.getByRole("link", { name: "Меню на сегодня" }).click();
  await page.waitForURL("**/menu");
  const today = page.getByTestId(`menu-day-${TODAY}`);
  await expect(today).toContainText("Сегодня");
  await expect(today).toContainText("гречка, молоко, масло");
  await expect(page.getByTestId(`menu-day-${TOMORROW}`)).toContainText("Повар ещё не заполнил меню");
  await expect(page.getByTestId("menu-fill")).toHaveCount(0);
  // date navigation
  await page.getByTestId("menu-next").click();
  await expect(page.getByTestId(`menu-day-${almaty(2)}`)).toBeVisible();
  await expect(page.getByTestId(`menu-day-${TOMORROW}`)).toContainText("Завтра");
});

test("cook copies a day (with overwrite confirmation) and clears it", async ({ page }) => {
  await login(page, PHONES.cook);
  await page.goto(`/menu/edit?date=${TOMORROW}`);
  await expect(page.getByTestId("dish-breakfast-0")).toHaveValue("");
  await page.getByTestId("menu-copy").click();
  await expect(page.getByTestId("menu-copy-overwrite")).toHaveCount(0);
  await page.getByTestId("menu-copy-from").fill(TODAY);
  await page.getByTestId("menu-copy-confirm").click();
  await expectToast(page, "Скопировано 3 блюда");
  await expect(page.getByTestId("dish-breakfast-0")).toHaveValue("Каша гречневая E2E");
  await expect(page.getByTestId("dish-lunch-0")).toHaveValue("Суп с фрикадельками");

  // Second copy into a filled day warns before replacing.
  await page.getByTestId("menu-copy").click();
  await expect(page.getByTestId("menu-copy-overwrite")).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();

  await page.goto("/menu");
  await expect(page.getByTestId(`menu-day-${TOMORROW}`)).toContainText("Суп с фрикадельками");

  await page.goto(`/menu/edit?date=${TOMORROW}`);
  await page.getByTestId("menu-clear").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Меню удалено");
  await page.goto("/menu");
  await expect(page.getByTestId(`menu-day-${TOMORROW}`)).toContainText("Повар ещё не заполнил меню");
  await expect(page.getByTestId("menu-fill")).toBeVisible();
});

test("head switches a meal off in settings → it disappears from the editor and the menu", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/settings");
  const snack = page.getByTestId("meal-switch-snack");
  await expect(snack).toHaveAttribute("aria-checked", "true");
  await snack.click();
  await expectToast(page, "Приёмы пищи сохранены");
  await expect(snack).toHaveAttribute("aria-checked", "false");

  await page.goto(`/menu/edit?date=${TODAY}`);
  await expect(page.getByTestId("meal-section-lunch")).toBeVisible();
  await expect(page.getByTestId("meal-section-snack")).toHaveCount(0);

  // Dinner is off by default; switch it on and back.
  await page.goto("/settings");
  await page.getByTestId("meal-switch-dinner").click();
  await expectToast(page, "Приёмы пищи сохранены");
  await page.goto(`/menu/edit?date=${TODAY}`);
  await expect(page.getByTestId("meal-section-dinner")).toBeVisible();

  await page.goto("/settings");
  await page.getByTestId("meal-switch-dinner").click();
  await expect(page.getByTestId("meal-switch-dinner")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("meal-switch-snack").click();
  await expect(page.getByTestId("meal-switch-snack")).toHaveAttribute("aria-checked", "true");
  await page.goto(`/menu/edit?date=${TODAY}`);
  await expect(page.getByTestId("meal-section-snack")).toBeVisible();
  await expect(page.getByTestId("meal-section-dinner")).toHaveCount(0);
});

test("teacher sees the menu without edit controls; edit URL and direct API writes are refused", async ({ page }) => {
  await login(page, PHONES.teacher);
  await expect(page.getByTestId("menu-today")).toContainText("Каша гречневая E2E");
  await page.goto("/menu");
  await expect(page.getByTestId(`menu-day-${TODAY}`)).toContainText("Суп с фрикадельками");
  await expect(page.getByTestId("menu-edit")).toHaveCount(0);
  await expect(page.getByTestId("menu-fill")).toHaveCount(0);

  await page.goto(`/menu/edit?date=${TODAY}`);
  await page.waitForURL((u) => u.pathname === "/");

  // Direct API as the teacher (RLS): reads work, writes are rejected.
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const signIn = await api.auth.signInWithPassword({ email: `${PHONES.teacher.replace(/\D/g, "")}@${process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local"}`, password: PASSWORD });
  expect(signIn.error).toBeNull();
  const menu = await api.from("menus").select("id").eq("kindergarten_id", kgA).eq("date", TODAY).single();
  expect(menu.data?.id).toBeTruthy();
  const ins = await api.from("menu_items").insert({ menu_id: menu.data!.id, kindergarten_id: kgA, meal: "lunch", dish: "Взлом" });
  expect(ins.error).not.toBeNull();
  const rpc = await api.rpc("save_menu", { p_kg: kgA, p_date: TODAY, p_items: [] });
  expect(rpc.error).not.toBeNull();
  const del = await api.from("menus").delete().eq("id", menu.data!.id).select("id");
  expect(del.data ?? []).toHaveLength(0);
  const still = await service().from("menu_items").select("dish").eq("menu_id", menu.data!.id);
  expect(still.data?.map((r) => r.dish)).not.toContain("Взлом");
  expect(still.data?.length).toBe(3);
});

test("cook's dashboard lists children with allergies", async ({ page }) => {
  await login(page, PHONES.cook);
  const list = page.getByTestId("allergies-list");
  await expect(list).toContainText("Дети с аллергиями");
  const alikhan = list.getByTestId("allergy-row").filter({ hasText: "Ахметов Алихан Даниярович" });
  await expect(alikhan).toContainText("орехи");
  await expect(alikhan).toContainText("Солнышко");
  const sabina = list.getByTestId("allergy-row").filter({ hasText: "Бекова Сабина Арманқызы" });
  await expect(sabina).toContainText("молоко");
  await expect(sabina).toContainText("Звёздочки");
  // The cook does not get the generic "menu today" widget.
  await expect(page.getByTestId("menu-today")).toHaveCount(0);
});

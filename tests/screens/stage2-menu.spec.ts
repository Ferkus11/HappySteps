import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

function almaty(offset = 0) {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  // Today filled, tomorrow empty — shows both states.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: kg } = await db.from("kindergartens").select("id").eq("slug", "e2e-a").single();
  await db.from("kindergarten_settings").update({ meals: ["breakfast", "second_breakfast", "lunch", "snack"] }).eq("kindergarten_id", kg!.id);
  await db.from("menus").delete().eq("kindergarten_id", kg!.id).in("date", [almaty(), almaty(1)]);
  const { data: m } = await db.from("menus").insert({ kindergarten_id: kg!.id, date: almaty() }).select("id").single();
  const rows = [
    ["breakfast", "Каша пшённая на молоке", "пшено, молоко, сливочное масло, сахар", 0],
    ["breakfast", "Какао", "какао, молоко", 1],
    ["second_breakfast", "Яблоко", null, 0],
    ["lunch", "Суп с фрикадельками", "говядина, картофель, морковь, лук, зелень", 0],
    ["lunch", "Плов с курицей", "рис, курица, морковь, лук", 1],
    ["lunch", "Компот из сухофруктов", null, 2],
    ["snack", "Сырники со сметаной", "творог, яйцо, мука, сметана", 0],
  ] as const;
  await db.from("menu_items").insert(rows.map(([meal, dish, composition, position]) => ({ menu_id: m!.id, kindergarten_id: kg!.id, meal, dish, composition, position })));
});

test("menu · cook", async ({ page }) => {
  await login(page, PHONES.cook);
  await snap(page, "stage2", "menu-cook-dashboard");
  await page.goto(`/menu/edit?date=${almaty()}`);
  await snap(page, "stage2", "menu-cook-editor");
  await page.goto(`/menu/edit?date=${almaty(1)}`);
  await snap(page, "stage2", "menu-cook-editor-empty");
  await page.getByTestId("menu-copy").click();
  await snap(page, "stage2", "menu-cook-copy");
  await page.keyboard.press("Escape");
  await page.goto("/menu");
  await snap(page, "stage2", "menu-cook-menu");
});

test("menu · parent, teacher, head", async ({ page, baseURL }) => {
  await login(page, PHONES.parent);
  await snap(page, "stage2", "menu-parent-dashboard");
  await page.goto("/menu");
  await snap(page, "stage2", "menu-parent-menu");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: baseURL! }]);
  await page.goto("/menu");
  await snap(page, "stage2", "menu-parent-menu-kk");
  await page.goto("/");
  await snap(page, "stage2", "menu-parent-dashboard-kk");

  await login(page, PHONES.teacher);
  await page.goto("/menu");
  await snap(page, "stage2", "menu-teacher-menu");

  await login(page, PHONES.head);
  await page.goto("/settings");
  await page.getByTestId("meals-card").scrollIntoViewIfNeeded();
  await snap(page, "stage2", "menu-head-settings");
});

test("menu · cook kk", async ({ page, baseURL }) => {
  await login(page, PHONES.cook);
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: baseURL! }]);
  await page.goto("/");
  await snap(page, "stage2", "menu-cook-dashboard-kk");
  await page.goto(`/menu/edit?date=${almaty()}`);
  await snap(page, "stage2", "menu-cook-editor-kk");
});

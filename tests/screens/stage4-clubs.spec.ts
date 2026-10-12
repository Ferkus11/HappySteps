import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";
import { seedClubs } from "../../scripts/seed/e2e-clubs";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const S = "stage4";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let A = "";
let clubs: Record<string, string> = {};
let toddler = "";
const TODDLER = "Ахметова Аружан Даниярқызы";

test.beforeAll(async () => {
  // Deterministic state: fixtures + Алихан queued in the full «Шахматы» + a second (2-year-old) child for the switcher.
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  const users: Record<string, string> = {};
  for (const [k, phone] of Object.entries(PHONES)) {
    const p = (await db.from("profiles").select("id").eq("phone", phone).maybeSingle()).data;
    if (p) users[k] = p.id;
  }
  await db.from("clubs").delete().eq("kindergarten_id", A).like("name", "E2E %");
  await db.from("children").delete().eq("kindergarten_id", A).eq("full_name", TODDLER);
  clubs = await seedClubs(db, { users, kindergartens: { A } });
  const kid = async (first: string) => (await db.from("children").select("id").eq("kindergarten_id", A).ilike("full_name", `%${first}%`).single()).data!.id as string;
  await db.from("club_enrollments").insert({ kindergarten_id: A, club_id: clubs["Шахматы"], child_id: await kid("Алихан"), status: "queued", queue_no: 1 });
  const { data: g } = await db.from("groups").select("id").eq("kindergarten_id", A).eq("name", "Солнышко").single();
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 2, d.getUTCMonth() - 1);
  toddler = (await db.from("children").insert({ kindergarten_id: A, full_name: TODDLER, birth_date: d.toISOString().slice(0, 10), group_id: g!.id, monthly_fee: 0 }).select("id").single()).data!.id;
  await db.from("child_guardians").insert({ child_id: toddler, user_id: users.parent, kindergarten_id: A, relation: "мама" });
});

test.afterAll(async () => {
  if (toddler) await db.from("children").delete().eq("id", toddler);
});

async function setLocale(page: Page, locale: "ru" | "kk") {
  const url = new URL(page.url());
  await page.context().addCookies([{ name: "hs_locale", value: locale, url: url.origin }]);
}

test("clubs · parent", async ({ page }) => {
  await login(page, PHONES.parent);
  await expect(page.getByTestId("parent-clubs")).toBeVisible();
  await page.getByTestId("parent-clubs").scrollIntoViewIfNeeded();
  await snap(page, S, "clubs-parent-dashboard");
  await page.goto("/clubs");
  await expect(page.getByTestId("child-switcher")).toBeVisible();
  await snap(page, S, "clubs-parent-catalog");
  await page.goto(`/clubs/${clubs["Рисование"]}`);
  await expect(page.getByTestId("enroll")).toBeVisible();
  await snap(page, S, "clubs-parent-detail");
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  await expect(page.getByTestId("enrollment-status")).toHaveAttribute("data-status", "queued");
  await snap(page, S, "clubs-parent-queued");
  await setLocale(page, "kk");
  await page.goto("/clubs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Үйірмелер");
  await snap(page, S, "clubs-parent-catalog-kk");
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  await snap(page, S, "clubs-parent-queued-kk");
  await setLocale(page, "ru");
});

test("clubs · head", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/clubs");
  await expect(page.getByTestId("pending-requests")).toBeVisible();
  await snap(page, S, "clubs-head-main");
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  await expect(page.getByTestId("club-queue")).toBeVisible();
  await snap(page, S, "clubs-head-detail");
  await page.getByTestId("edit-club").click();
  await expect(page.getByTestId("club-name")).toBeVisible();
  await snap(page, S, "clubs-head-form");
  await page.keyboard.press("Escape");
  await setLocale(page, "kk");
  await page.goto("/clubs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Үйірмелер");
  await snap(page, S, "clubs-head-main-kk");
  await setLocale(page, "ru");
});

test("clubs · club teacher", async ({ page }) => {
  await login(page, PHONES.clubTeacher);
  await expect(page.getByTestId("teacher-clubs")).toBeVisible();
  await snap(page, S, "clubs-clubteacher-dashboard");
  await page.goto("/clubs");
  await expect(page.getByTestId("my-clubs")).toBeVisible();
  await snap(page, S, "clubs-clubteacher-main");
  await page.goto(`/clubs/${clubs["Рисование"]}`);
  await expect(page.getByTestId("club-requests")).toBeVisible();
  await snap(page, S, "clubs-clubteacher-roster");
  await setLocale(page, "kk");
  await page.goto(`/clubs/${clubs["Рисование"]}`);
  await snap(page, S, "clubs-clubteacher-roster-kk");
  await setLocale(page, "ru");
});

test("clubs · teacher and accountant (read-only)", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/clubs");
  await expect(page.getByTestId("club-catalog")).toBeVisible();
  await snap(page, S, "clubs-teacher-catalog");
  await login(page, PHONES.accountant);
  await page.goto(`/clubs/${clubs["Шахматы"]}`);
  await expect(page.getByTestId("club-attending")).toBeVisible();
  await snap(page, S, "clubs-accountant-detail");
});

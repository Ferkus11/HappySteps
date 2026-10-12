import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { snap } from "./helpers";
import { PHONES, login } from "../e2e/helpers";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
let A = "";
let addedWorkingDay = false;

test.beforeAll(async () => {
  A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id;
  const { data: working } = await db.rpc("kg_is_working_day", { kg: A, d: today });
  if (!working) {
    const { data: existing } = await db.from("holidays").select("id").eq("kindergarten_id", A).eq("date", today).maybeSingle();
    if (!existing) {
      await db.from("holidays").insert({ kindergarten_id: A, date: today, name: "Screens", kind: "working_day" });
      addedWorkingDay = true;
    }
  }
  await db.from("child_attendance").delete().eq("kindergarten_id", A).eq("date", today);
  await db.from("absence_reports").delete().eq("kindergarten_id", A).gte("date_to", today);
  const kids = (await db.from("children").select("id, full_name").eq("kindergarten_id", A)).data!;
  const id = (n: string) => kids.find((k) => k.full_name.includes(n))!.id;
  await db.from("absence_reports").insert({ kindergarten_id: A, child_id: id("Алихан"), date_from: today, date_to: addDays(today, 2), reason: "sick", comment: "Температура" });
  await db.from("child_attendance").insert({ kindergarten_id: A, child_id: id("Миша"), date: today, status: "present" });
});

test.afterAll(async () => {
  await db.from("child_attendance").delete().eq("kindergarten_id", A).eq("date", today);
  await db.from("absence_reports").delete().eq("kindergarten_id", A).gte("date_to", today);
  if (addedWorkingDay) await db.from("holidays").delete().eq("kindergarten_id", A).eq("date", today).eq("name", "Screens");
});

test("stage 2 · attendance · teacher", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.getByTestId("teacher-today").first().waitFor();
  await snap(page, "stage2", "attendance-teacher-dashboard");
  await page.goto("/attendance");
  await page.getByTestId("attendance-list").waitFor();
  await snap(page, "stage2", "attendance-teacher-marking");
  await page.goto("/attendance/report");
  await page.getByTestId("attendance-grid").waitFor();
  await snap(page, "stage2", "attendance-teacher-report");
  await page.context().addCookies([{ name: "hs_locale", value: "kk", url: new URL(page.url()).origin }]);
  await page.goto("/attendance");
  await page.getByTestId("attendance-list").waitFor();
  await snap(page, "stage2", "attendance-teacher-marking-kk");
  await page.context().clearCookies({ name: "hs_locale" });
});

test("stage 2 · attendance · parent", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.getByTestId("parent-today").waitFor();
  await snap(page, "stage2", "attendance-parent-dashboard");
  await page.getByTestId("report-absence").first().click();
  await page.getByTestId("absence-mode-period").click();
  await snap(page, "stage2", "attendance-parent-report-dialog");
});

test("stage 2 · attendance · cook, owner, head, accountant", async ({ page }) => {
  await login(page, PHONES.cook);
  await page.getByTestId("portions-card").waitFor();
  await snap(page, "stage2", "attendance-cook-dashboard");
  await login(page, PHONES.owner);
  await page.getByTestId("portions-card").waitFor();
  await snap(page, "stage2", "attendance-owner-dashboard");
  await login(page, PHONES.head);
  await page.goto("/attendance");
  await page.getByTestId("attendance-list").waitFor();
  await snap(page, "stage2", "attendance-head-marking");
  await page.goto(`/attendance/report?month=${addDays(today, -28).slice(0, 7)}`);
  await page.getByTestId("attendance-grid").waitFor();
  await snap(page, "stage2", "attendance-head-report");
  await login(page, PHONES.accountant);
  await page.goto("/attendance");
  await page.getByTestId("attendance-list").waitFor();
  await snap(page, "stage2", "attendance-accountant-view");
});

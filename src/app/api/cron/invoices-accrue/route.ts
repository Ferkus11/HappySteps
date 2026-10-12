import { cronUnauthorized } from "@/lib/cron";
import { createServiceClient } from "@/lib/supabase/service";
import { todayIn } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Daily: makes sure every active kindergarten has this month's invoices (SPEC §5.9 — accrual on the 1st,
 * in the kindergarten's time zone). Idempotent: invoices_accrue() creates only missing (child, month) rows for
 * children who have already started (enrolled_on ≤ today), so the run on the 1st bills everyone enrolled by then
 * and a child starting mid-month is billed on their first day (full fee, flagged for the accountant to check).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const db = createServiceClient();
  const { data: kgs, error } = await db.from("kindergartens").select("id, kindergarten_settings(timezone)").eq("status", "active");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let created = 0;
  for (const kg of kgs ?? []) {
    const s = (Array.isArray(kg.kindergarten_settings) ? kg.kindergarten_settings[0] : kg.kindergarten_settings) as { timezone: string } | null;
    const period = `${todayIn(s?.timezone ?? "Asia/Almaty").slice(0, 7)}-01`;
    const { data, error: e } = await db.rpc("invoices_accrue", { p_kg: kg.id, p_period: period });
    if (e) {
      console.error("invoices accrue failed", kg.id, e.message);
      continue;
    }
    created += Number(data ?? 0);
  }
  return Response.json({ ok: true, created });
}

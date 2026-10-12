import { cronUnauthorized } from "@/lib/cron";
import { createServiceClient } from "@/lib/supabase/service";
import { notify } from "@/lib/notify";
import { formatDate, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Every 15 minutes: closes intervals people forgot to finish (shift end + 2 h, closed at the shift end,
 * flag `auto_closed`) and notifies them. Idempotent — only open intervals are touched, so a repeated run
 * finds nothing. Time-zone logic lives in SQL (`worktime_autoclose`, kindergarten time zone).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const db = createServiceClient();
  const { data, error } = await db.rpc("worktime_autoclose");
  if (error) {
    console.error("worktime_autoclose", error.message);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  const rows = (data ?? []) as { session_id: string; kindergarten_id: string; user_id: string; work_date: string; ended_at: string }[];
  const tz = new Map<string, string>();
  for (const r of rows) {
    if (!tz.has(r.kindergarten_id)) {
      const { data: s } = await db.from("kindergarten_settings").select("timezone").eq("kindergarten_id", r.kindergarten_id).maybeSingle();
      tz.set(r.kindergarten_id, (s?.timezone as string | undefined) ?? "Asia/Almaty");
    }
    await notify({
      kindergartenId: r.kindergarten_id,
      userIds: [r.user_id],
      type: "worktime.auto_closed",
      params: { date: formatDate(r.work_date), time: formatTime(r.ended_at, tz.get(r.kindergarten_id)) },
      url: "/worktime",
    });
  }
  return Response.json({ closed: rows.length });
}

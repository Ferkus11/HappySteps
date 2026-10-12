import { cronUnauthorized } from "@/lib/cron";
import { createServiceClient } from "@/lib/supabase/service";
import { notify } from "@/lib/notify";
import { reminderDate } from "@/lib/events";
import { formatDate, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Hourly: reminds the audience of each event one day before it (SPEC §5.6), in the kindergarten's
 * time zone. Idempotent: claim_event_reminders() marks events atomically (re-armed if the date moves).
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const db = createServiceClient();
  const { data: kgs, error } = await db
    .from("kindergartens")
    .select("id, name, kindergarten_settings(timezone, quiet_hours_end)")
    .eq("status", "active");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const now = new Date();
  let sent = 0;
  let events = 0;
  for (const kg of kgs ?? []) {
    const s = (Array.isArray(kg.kindergarten_settings) ? kg.kindergarten_settings[0] : kg.kindergarten_settings) as
      | { timezone: string; quiet_hours_end: string }
      | null;
    const tz = s?.timezone ?? "Asia/Almaty";
    const day = reminderDate(now, tz, s?.quiet_hours_end ?? "08:00");
    if (!day) continue;
    const { data: claimed, error: claimErr } = await db.rpc("claim_event_reminders", { p_kg: kg.id, p_date: day });
    if (claimErr) {
      console.error("event reminders: claim failed", kg.id, claimErr.message);
      continue;
    }
    for (const e of (claimed ?? []) as { id: string; title: string; date: string; start_time: string | null; end_time: string | null; place: string | null }[]) {
      const { data: users } = await db.rpc("event_recipients", { p_id: e.id });
      const ids = ((users ?? []) as unknown[]).map((u) => (typeof u === "string" ? u : (u as { event_recipients: string }).event_recipients));
      const time = e.start_time ? formatTime(e.start_time) + (e.end_time ? `–${formatTime(e.end_time)}` : "") : "";
      await notify({
        kindergartenId: kg.id,
        userIds: ids,
        type: "event.reminder",
        params: { title: e.title, date: formatDate(e.date), time, place: e.place ?? kg.name },
        url: `/events?day=${e.date}`,
      });
      events++;
      sent += ids.length;
    }
  }
  return Response.json({ ok: true, events, notified: sent });
}

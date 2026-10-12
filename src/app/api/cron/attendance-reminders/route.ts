import { cronUnauthorized } from "@/lib/cron";
import { createServiceClient } from "@/lib/supabase/service";
import { memberIds, notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Attendance reminders (SPEC §5.3), every 15 minutes. Selection lives in SQL
 * (`attendance_reminders_due`: working day, kindergarten time zone, reminder/escalation time,
 * group not fully marked, not sent yet). A reminder is sent only when its bookkeeping row was
 * inserted by this run, so overlapping runs never notify twice.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const db = createServiceClient();
  const { data: due, error } = await db.rpc("attendance_reminders_due");
  if (error) {
    console.error("attendance reminders:", error.message);
    return Response.json({ error: "db" }, { status: 500 });
  }
  let sent = 0;
  for (const r of (due ?? []) as { kindergarten_id: string; group_id: string; group_name: string; date: string; level: "teacher" | "head" }[]) {
    const { data: claimed } = await db
      .from("attendance_reminders")
      .upsert({ kindergarten_id: r.kindergarten_id, group_id: r.group_id, date: r.date, level: r.level }, { onConflict: "group_id,date,level", ignoreDuplicates: true })
      .select("group_id");
    if (!claimed?.length) continue;
    let userIds: string[];
    if (r.level === "teacher") {
      const { data: gt } = await db.from("group_teachers").select("user_id").eq("group_id", r.group_id);
      const teachers = new Set(await memberIds(r.kindergarten_id, ["teacher"]));
      userIds = (gt ?? []).map((x) => x.user_id as string).filter((id) => teachers.has(id));
    } else {
      userIds = await memberIds(r.kindergarten_id, ["head"]);
      if (!userIds.length) userIds = await memberIds(r.kindergarten_id, ["owner"]);
    }
    await notify({
      kindergartenId: r.kindergarten_id,
      userIds,
      type: "attendance.not_marked",
      params: { group: r.group_name },
      url: `/attendance?group=${r.group_id}`,
    });
    sent++;
  }
  return Response.json({ ok: true, due: due?.length ?? 0, sent });
}

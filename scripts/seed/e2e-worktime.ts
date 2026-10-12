/**
 * Work-time fixtures (stage 2A). Idempotent.
 * - Mon–Fri 08:00–17:00 schedules for the staff of garden A (owner has no schedule).
 * - ~2 months of past sessions for teacher +77010000004 (a few late days, one auto-closed,
 *   one corrected by the head, a sick leave).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

type Ids = { users: Record<string, string>; kindergartens: { A: string; B: string } };

function today(tz = "Asia/Almaty") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekday(iso: string) {
  const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}
const at = (date: string, time: string) => `${date}T${time}:00+05:00`; // Asia/Almaty

export async function seedWorktime(db: SupabaseClient, ids: Ids) {
  const A = ids.kindergartens.A;
  const u = ids.users;
  const staff = [u.head, u.accountant, u.teacher, u.clubTeacher, u.cook, u.teacherParent];
  const rows = staff.flatMap((user_id) =>
    [1, 2, 3, 4, 5].map((weekday) => ({ kindergarten_id: A, user_id, weekday, start_time: "08:00", end_time: "17:00" })),
  );
  must(await db.from("staff_schedules").upsert(rows, { onConflict: "kindergarten_id,user_id,weekday", ignoreDuplicates: true }), "schedules");

  const t = today();
  const from = addDays(t, -62);
  const { data: existing } = await db.from("work_sessions").select("work_date").eq("kindergarten_id", A).eq("user_id", u.teacher).gte("work_date", from).lt("work_date", t);
  const have = new Set((existing ?? []).map((r) => r.work_date as string));

  // Sick leave: a Mon–Tue about five weeks ago.
  let sickFrom = addDays(t, -35);
  while (weekday(sickFrom) !== 1) sickFrom = addDays(sickFrom, 1);
  const sickTo = addDays(sickFrom, 1);
  const { data: abs } = await db.from("staff_absences").select("id").eq("kindergarten_id", A).eq("user_id", u.teacher).eq("date_from", sickFrom).maybeSingle();
  if (!abs) must(await db.from("staff_absences").insert({ kindergarten_id: A, user_id: u.teacher, kind: "sick", date_from: sickFrom, date_to: sickTo, note: "Больничный лист" }), "absence");

  const sessions: Record<string, unknown>[] = [];
  let i = 0;
  for (let d = from; d < t; d = addDays(d, 1)) {
    if (weekday(d) > 5) continue;
    i++;
    if (d >= sickFrom && d <= sickTo) continue;
    if (i % 17 === 0) continue; // a missed day
    if (have.has(d)) continue;
    const late = i % 6 === 0;
    // Bulk inserts need identical keys in every row.
    const base = { kindergarten_id: A, user_id: u.teacher, work_date: d, created_by: u.teacher, auto_closed: false, edited: false, edit_comment: null, edited_by: null, edited_at: null };
    if (i % 13 === 0) {
      sessions.push({ ...base, started_at: at(d, "07:56"), ended_at: at(d, "17:00"), auto_closed: true });
    } else if (i % 11 === 0) {
      sessions.push({
        ...base,
        started_at: at(d, "08:00"),
        ended_at: at(d, "16:30"),
        edited: true,
        edit_comment: "Забыла отметиться утром, подтверждено заведующей",
        edited_by: u.head,
        edited_at: at(d, "17:00"),
      });
    } else if (i % 9 === 0) {
      // A break: two intervals.
      sessions.push({ ...base, started_at: at(d, "07:58"), ended_at: at(d, "12:00") });
      sessions.push({ ...base, started_at: at(d, "13:00"), ended_at: at(d, "17:04") });
    } else {
      const m = String(50 + (i % 9)).padStart(2, "0");
      sessions.push({ ...base, started_at: late ? at(d, "08:25") : at(d, `07:${m}`), ended_at: at(d, i % 2 ? "17:02" : "17:10") });
    }
  }
  if (sessions.length) must(await db.from("work_sessions").insert(sessions), "sessions");
}

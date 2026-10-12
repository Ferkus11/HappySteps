/**
 * Attendance history for garden A (last ~2 months, never today) — for the monthly report,
 * the dashboard and screenshots. Idempotent: existing rows are left untouched.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

const REASONS = ["sick", "vacation", "family", "other"] as const;

function todayAlmaty(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export async function seedAttendance(db: SupabaseClient, ids: { A: string }) {
  const today = todayAlmaty();
  const from = addDays(today, -60);
  const [children, holidays] = await Promise.all([
    db.from("children").select("id, full_name, enrolled_on").eq("kindergarten_id", ids.A).eq("status", "active").not("group_id", "is", null),
    db.from("holidays").select("date, kind").eq("kindergarten_id", ids.A).gte("date", from).lt("date", today),
  ]);
  const hol = new Map((must(holidays, "holidays") as { date: string; kind: string }[]).map((h) => [h.date, h.kind]));
  const kids = must(children, "children") as { id: string; full_name: string; enrolled_on: string }[];

  // One past sick report (two days, ten days ago) for the first child.
  const alikhan = kids.find((k) => k.full_name.includes("Алихан"));
  const sickFrom = addDays(today, -10);
  const sickTo = addDays(today, -9);
  if (alikhan) {
    const { data: existing } = await db.from("absence_reports").select("id").eq("child_id", alikhan.id).eq("date_from", sickFrom).maybeSingle();
    if (!existing) {
      await db.from("absence_reports").insert({ kindergarten_id: ids.A, child_id: alikhan.id, date_from: sickFrom, date_to: sickTo, reason: "sick", comment: "Температура" });
    }
  }

  const rows: { kindergarten_id: string; child_id: string; date: string; status: string; reason: string | null }[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const kind = hol.get(d);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    const working = kind === "working_day" || (!kind && wd !== 0 && wd !== 6);
    if (!working) continue;
    for (const k of kids) {
      if (k.enrolled_on > d) continue;
      const inSick = alikhan?.id === k.id && d >= sickFrom && d <= sickTo;
      const h = hash(`${k.id}${d}`);
      const absent = inSick || h % 9 === 0;
      rows.push({
        kindergarten_id: ids.A,
        child_id: k.id,
        date: d,
        status: absent ? "absent" : "present",
        reason: inSick ? "sick" : absent && h % 2 === 0 ? REASONS[h % 4] : null,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const res = await db.from("child_attendance").upsert(rows.slice(i, i + 500), { onConflict: "child_id,date", ignoreDuplicates: true });
    if (res.error) throw new Error(`attendance: ${JSON.stringify(res.error)}`);
  }
}

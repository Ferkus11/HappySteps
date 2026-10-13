/**
 * Demo: holidays, menus, children's attendance with parents' absence reports, staff schedules and work sessions.
 * Everything is written as the app would have written it over the last three months (D-017, D-018, D-019).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MENUS } from "./demo-content";
import { addDays, at, daysBetween, hm, insertMany, toMinutes, uuid, weekday } from "./demo-lib";
import { groupOn, shiftOn, type Child, type Staff, type World } from "./demo-world";

type Row = Record<string, unknown>;

export async function seedHolidays(db: SupabaseClient, w: World) {
  const rows = [...w.holidays.entries()].map(([date, h]) => ({ id: uuid(), kindergarten_id: w.kgId, date, name: h.name, kind: h.kind }));
  await insertMany(db, "holidays", rows);
}

export async function seedMenus(db: SupabaseClient, w: World) {
  const cook = w.s.cook.id;
  const days: string[] = [];
  // The last two weeks, today and the next working days (the cook plans a week ahead).
  for (let d = addDays(w.today, -14); d <= addDays(w.today, 7); d = addDays(d, 1)) {
    if (weekday(d) <= 5 && !w.holidays.has(d)) days.push(d);
  }
  const menus: Row[] = [];
  const items: Row[] = [];
  for (const d of days) {
    const id = uuid();
    const m = MENUS[(daysBetween("2026-01-05", d) + 70000) % MENUS.length];
    const planned = addDays(d, -w.rng.int(2, 6));
    menus.push({ id, kindergarten_id: w.kgId, date: d, updated_by: cook, updated_at: at(planned, "14:20"), created_at: at(planned, "14:05") });
    for (const meal of ["breakfast", "second_breakfast", "lunch", "snack"] as const) {
      m[meal].forEach(([dish, composition], position) => items.push({ id: uuid(), menu_id: id, kindergarten_id: w.kgId, meal, dish, composition, position }));
    }
  }
  await insertMany(db, "menus", menus);
  await insertMany(db, "menu_items", items);
}

// ───────────────────────────── Attendance ─────────────────────────────
interface Episode {
  from: string;
  to: string;
  reason: "sick" | "vacation" | "family" | "other" | null;
  reported: boolean;
  comment: string | null;
}

const SICK_COMMENTS = ["Температура 38", "Насморк и кашель", "Простуда, лечимся дома", "Ротавирус", "Болит горло", null, null];
const VACATION_COMMENTS = ["Уезжаем к бабушке в Шымкент", "Отпуск на Иссык-Куле", "Едем на море", "Отдыхаем в Бурабае", null];
const FAMILY_COMMENTS = ["Семейное торжество", "Поездка к врачу", "Свадьба у родственников", null];

/** Absence episodes of a child over the window: illness, summer holidays, family days. */
function episodes(w: World, c: Child, days: string[]): Episode[] {
  const out: Episode[] = [];
  const rng = w.rng;
  const young = c.group === "balapan" || c.group === "botakan";
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const summer = d.slice(5, 7) === "07" || d.slice(5, 7) === "08";
    const r = rng.next();
    // Autumn is the season of colds.
    const autumn = d.slice(5, 7) >= "09";
    const pSick = (young ? 0.022 : 0.013) * (autumn ? 1.35 : 1);
    let len = 0;
    let reason: Episode["reason"] = null;
    if (r < pSick) {
      len = rng.int(2, 5);
      reason = "sick";
    } else if (summer && r < pSick + 0.012) {
      len = rng.int(4, 9);
      reason = "vacation";
    } else if (r < pSick + (summer ? 0.012 : 0) + 0.006) {
      len = 1;
      reason = "family";
    } else if (r < pSick + (summer ? 0.012 : 0) + 0.006 + 0.016) {
      len = 1;
      reason = rng.chance(0.4) ? "other" : null;
    }
    if (len) {
      const to = days[Math.min(days.length - 1, i + len - 1)];
      const reported = reason === "vacation" ? rng.chance(0.85) : reason === "sick" ? rng.chance(0.6) : reason === "family" ? rng.chance(0.5) : false;
      const comment = reason === "sick" ? rng.pick(SICK_COMMENTS) : reason === "vacation" ? rng.pick(VACATION_COMMENTS) : reason === "family" ? rng.pick(FAMILY_COMMENTS) : null;
      out.push({ from: d, to, reason: reported ? (reason ?? "other") : reason, reported, comment });
      i += len + 1;
    } else i++;
  }
  return out;
}

export interface AttendanceResult {
  /** sick episodes in the last six weeks (for «справка после болезни») */
  recentSick: { child: Child; to: string }[];
  /** reports covering today or later (for teacher notifications) */
  current: { child: Child; from: string; to: string; reason: string }[];
}

export async function seedAttendance(db: SupabaseClient, w: World): Promise<AttendanceResult> {
  const rng = w.rng;
  const today = w.today;
  const todayWorking = w.workingDays.includes(today);
  const past = w.workingDays.filter((d) => d < today);
  const reports: Row[] = [];
  const marks: Row[] = [];
  const recentSick: AttendanceResult["recentSick"] = [];
  const current: AttendanceResult["current"] = [];
  const teacherOf = (g: string) => w.groups.get(g)!.teachers[0];
  const parentOf = (c: Child) => c.family.parents[0];

  // Groups left unmarked today: the demo teacher's group (her primary action on the dashboard).
  const unmarkedToday = new Set(["zhuldyz"]);

  for (const c of w.children) {
    const days = past.filter((d) => groupOn(c, d) !== null);
    const eps = episodes(w, c, days);
    const absentOn = new Map<string, Episode>();
    for (const e of eps) {
      for (const d of days) if (d >= e.from && d <= e.to) absentOn.set(d, e);
      if (e.reported) {
        // Vacation is reported in advance, illness on the morning of the first day.
        const created = e.reason === "vacation" ? at(addDays(e.from, -rng.int(2, 6)), hm(rng.int(19 * 60, 22 * 60))) : at(e.from, hm(rng.int(6 * 60 + 30, 8 * 60 + 30)));
        reports.push({ id: uuid(), kindergarten_id: w.kgId, child_id: c.id, date_from: e.from, date_to: e.to, reason: e.reason, comment: e.comment, created_by: parentOf(c).id, created_at: created });
      }
      if (e.reason === "sick" && daysBetween(e.to, today) <= 42 && daysBetween(e.from, e.to) >= 2) recentSick.push({ child: c, to: e.to });
    }
    for (const d of days) {
      const e = absentOn.get(d);
      const g = groupOn(c, d)!;
      const teacher = teacherOf(g);
      marks.push({
        id: uuid(), kindergarten_id: w.kgId, child_id: c.id, date: d,
        status: e ? "absent" : "present",
        // a reported absence takes its reason from the report (trigger); otherwise the teacher's choice
        reason: e && !e.reported ? e.reason : null,
        marked_by: teacher.id,
        marked_at: at(d, hm(8 * 60 + 25 + rng.int(0, 50))),
      });
    }
  }

  // Reports covering today and the coming days (sick today, a planned vacation next week).
  const active = w.children.filter((c) => !c.leave && c.enrolled < today);
  const pick = (g: string, n: number, skip: Set<string>) =>
    rng.shuffle(active.filter((c) => c.group === g && !skip.has(c.id) && c.family !== w.demoParent)).slice(0, n);
  const used = new Set<string>();
  const future: { c: Child; from: string; to: string; reason: "sick" | "vacation" | "family"; comment: string | null; created: string }[] = [];
  const nextWorking = (d: string, n: number) => {
    let x = d;
    let k = 0;
    while (k < n) {
      x = addDays(x, 1);
      if (weekday(x) <= 5 && !w.holidays.has(x)) k++;
    }
    return x;
  };
  for (const [g, n] of [["zhuldyz", 2], ["botakan", 1], ["raduga", 1], ["balapan", 1]] as const) {
    for (const c of pick(g, n, used)) {
      used.add(c.id);
      future.push({ c, from: today, to: nextWorking(today, rng.int(1, 3)), reason: "sick", comment: rng.pick(SICK_COMMENTS), created: at(today, hm(Math.min(w.nowMin - 5, 7 * 60 + rng.int(0, 50)))) });
    }
  }
  for (const c of pick("kunshuak", 1, used)) {
    used.add(c.id);
    future.push({ c, from: today, to: today, reason: "family", comment: "Едем на свадьбу в Талдыкорган", created: at(addDays(today, -1), "20:40") });
  }
  // The demo parent's daughter: vacation next week, reported two days ago.
  const aylin = w.demoParent.children.find((c) => c.group === "botakan")!;
  const vFrom = nextWorking(today, 5);
  future.push({ c: aylin, from: vFrom, to: nextWorking(vFrom, 4), reason: "vacation", comment: "Едем к бабушке в Шымкент", created: at(addDays(today, -2), "21:15") });
  for (const c of pick("zerde", 1, used)) {
    used.add(c.id);
    const f = nextWorking(today, 2);
    future.push({ c, from: f, to: nextWorking(f, 1), reason: "family", comment: null, created: at(addDays(today, -1), "18:05") });
  }
  for (const f of future) {
    reports.push({ id: uuid(), kindergarten_id: w.kgId, child_id: f.c.id, date_from: f.from, date_to: f.to, reason: f.reason, comment: f.comment, created_by: parentOf(f.c).id, created_at: f.created });
    current.push({ child: f.c, from: f.from, to: f.to, reason: f.reason });
  }

  // Today: every group except the demo teacher's is already marked (if the garden is open today).
  if (todayWorking) {
    const reportedToday = new Set(future.filter((f) => f.from <= today && f.to >= today).map((f) => f.c.id));
    const markTime = Math.min(w.nowMin - 1, 9 * 60 + 5);
    if (markTime > 7 * 60) {
      for (const c of w.children) {
        const g = groupOn(c, today);
        if (!g || unmarkedToday.has(g) || c.leave) continue;
        const absent = reportedToday.has(c.id) || rng.chance(0.06);
        marks.push({
          id: uuid(), kindergarten_id: w.kgId, child_id: c.id, date: today, status: absent ? "absent" : "present",
          reason: null,
          marked_by: w.groups.get(g)!.teachers[0].id, marked_at: at(today, hm(markTime - rng.int(0, 30))),
        });
      }
    }
  }

  await insertMany(db, "absence_reports", reports);
  await insertMany(db, "child_attendance", marks, 1000);
  return { recentSick, current };
}

// ───────────────────────────── Work time ─────────────────────────────
export interface WorktimeResult {
  autoClosed: { staff: Staff; date: string; end: string; sessionId: string }[];
}

export async function seedWorktime(db: SupabaseClient, w: World): Promise<WorktimeResult> {
  const rng = w.rng;
  const kg = w.kgId;
  const head = w.s.head.id;
  const today = w.today;
  const schedules: Row[] = [];
  const overrides: Row[] = [];
  const absences: Row[] = [];
  const sessions: Row[] = [];
  const audit: Row[] = [];
  const autoClosed: WorktimeResult["autoClosed"] = [];
  const team = w.staff.filter((st) => st.schedule.length);

  for (const st of team) {
    for (const sh of st.schedule) schedules.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, weekday: sh.weekday, start_time: sh.start, end_time: sh.end, updated_at: at(st.hired, "10:00") });
  }

  // Absences: summer vacations, a few sick leaves, days off, one unexcused day.
  const absence = (st: Staff, kind: string, from: string, to: string, note: string | null) => {
    absences.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, kind, date_from: from, date_to: to, note, created_by: head, created_at: at(addDays(from, kind === "vacation" ? -10 : 0), "09:40") });
    audit.push({ kindergarten_id: kg, actor_id: head, action: "worktime.absence", entity: "staff", entity_id: st.id, details: { user_id: st.id, kind, from, to }, created_at: at(addDays(from, kind === "vacation" ? -10 : 0), "09:40") });
  };
  const workdays = (from: string, n: number) => {
    const out: string[] = [];
    for (let d = from; out.length < n; d = addDays(d, 1)) if (weekday(d) <= 5 && !w.holidays.has(d)) out.push(d);
    return out;
  };
  const summerStaff = rng.shuffle(team.filter((st) => !st.login && !st.archivedOn)).slice(0, 5);
  summerStaff.forEach((st, i) => {
    const days = workdays(addDays(w.start, 3 + i * 9), 10);
    if (days[0] < st.hired) return;
    absence(st, "vacation", days[0], days[days.length - 1], "Ежегодный отпуск");
  });
  const sickStaff = rng.shuffle(team.filter((st) => !summerStaff.includes(st) && st.key !== "teacher")).slice(0, 5);
  sickStaff.forEach((st, i) => {
    const days = workdays(addDays(w.start, 20 + i * 13), rng.int(2, 4));
    if (days[days.length - 1] >= today) return;
    absence(st, "sick", days[0], days[days.length - 1], "Больничный лист");
  });
  // Somebody is on sick leave today (tile «Отсутствует»).
  const sickToday = w.s.t_raduga_B;
  absence(sickToday, "sick", addDays(today, -1), addDays(today, 2), "Больничный лист");
  const dayOff = rng.shuffle(team.filter((st) => !st.login)).slice(0, 3);
  dayOff.forEach((st, i) => {
    const [d] = workdays(addDays(w.start, 35 + i * 11), 1);
    absence(st, "day_off", d, d, "Отгул за работу на ярмарке");
  });
  const unexcused = w.s.t_zerde_B;
  const [unexcusedDay] = workdays(addDays(today, -26), 1);
  absence(unexcused, "unexcused", unexcusedDay, unexcusedDay, null);

  // Schedule overrides: a substitution, a short day before the holiday, a shift for the graduation party.
  const sub = w.s.t_kunshuak_B;
  const [subDay] = workdays(addDays(today, -9), 1);
  overrides.push({ id: uuid(), kindergarten_id: kg, user_id: sub.id, date: subDay, kind: "shift", start_time: "08:00", end_time: "19:00", note: "Замена: основной воспитатель на семинаре", created_by: head, created_at: at(addDays(subDay, -2), "16:00") });
  overrides.push({ id: uuid(), kindergarten_id: kg, user_id: w.s.music.id, date: w.graduation, kind: "shift", start_time: "08:00", end_time: "15:00", note: "Проводы в школу", created_by: head, created_at: at(addDays(w.graduation, -5), "11:00") });
  const [upcoming] = workdays(addDays(today, 3), 1);
  overrides.push({ id: uuid(), kindergarten_id: kg, user_id: w.s.head.id, date: upcoming, kind: "shift", start_time: "08:00", end_time: "14:00", note: "Сокращённый день: семинар в управлении образования", created_by: w.s.owner.id, created_at: at(addDays(today, -1), "12:00") });
  const [offDay] = workdays(addDays(today, -16), 1);
  overrides.push({ id: uuid(), kindergarten_id: kg, user_id: w.s.cook3.id, date: offDay, kind: "day_off", start_time: null, end_time: null, note: "Поменялась сменой", created_by: head, created_at: at(addDays(offDay, -3), "15:00") });

  const overrideOn = new Map(overrides.map((o) => [`${o.user_id as string}|${o.date as string}`, o]));
  const absentOn = (st: Staff, d: string) =>
    absences.some((a) => a.user_id === st.id && (a.date_from as string) <= d && (a.date_to as string) >= d);

  const base = (st: Staff, d: string) => ({ kindergarten_id: kg, user_id: st.id, work_date: d, created_by: st.id, auto_closed: false, edited: false, edit_comment: null, edited_by: null, edited_at: null });
  const EDIT_COMMENTS = ["Забыла отметиться утром, подтверждено заведующей", "Ушла раньше по согласованию", "Сбой телефона, время по журналу охраны", "Отметилась по ошибке дважды"];

  // Today's picture for the tiles: one late, one not marked yet.
  const lateToday = w.s.cook2;
  const unmarkedToday = w.s.t_balapan_A;
  const todayWorking = w.workingDays.includes(today);

  for (const st of team) {
    const last = st.archivedOn ? addDays(st.archivedOn, -1) : today;
    for (const d of w.workingDays) {
      if (d < st.hired || d > last) continue;
      const o = overrideOn.get(`${st.id}|${d}`);
      if (o?.kind === "day_off") continue;
      const sh = o ? { start: o.start_time as string, end: o.end_time as string } : shiftOn(st, d);
      if (!sh) continue;
      if (absentOn(st, d)) continue;
      const s0 = toMinutes(sh.start);
      const e0 = toMinutes(sh.end);
      if (d === today) {
        if (!todayWorking || st === unmarkedToday) continue;
        const late = st === lateToday;
        const startMin = late ? s0 + 24 : s0 - rng.int(2, 14);
        if (startMin >= w.nowMin) continue; // not started yet
        const finished = w.nowMin > e0 + 20;
        sessions.push({ ...base(st, d), id: uuid(), started_at: at(d, hm(startMin)), ended_at: finished ? at(d, hm(e0 + rng.int(0, 15))) : null });
        continue;
      }
      const r = rng.next();
      if (r < 0.012) continue; // forgot to mark at all («Не отметились» in the timesheet)
      if (r < 0.03) {
        const id = uuid();
        const startMin = s0 - rng.int(1, 10);
        sessions.push({ ...base(st, d), id, started_at: at(d, hm(startMin)), ended_at: at(d, sh.end), auto_closed: true });
        audit.push({ kindergarten_id: kg, actor_id: null, action: "worktime.auto_close", entity: "work_session", entity_id: id, details: { user_id: st.id, work_date: d, ended_at: at(d, sh.end) }, created_at: at(d, hm(e0 + 120 + rng.int(1, 9))) });
        autoClosed.push({ staff: st, date: d, end: sh.end, sessionId: id });
        continue;
      }
      if (r < 0.045) {
        const id = uuid();
        const comment = rng.pick(EDIT_COMMENTS);
        const editedAt = at(addDays(d, 1), hm(9 * 60 + rng.int(0, 90)));
        const endMin = comment.startsWith("Ушла") ? e0 - 60 : e0 + rng.int(0, 10);
        sessions.push({ ...base(st, d), id, started_at: at(d, hm(s0 - rng.int(0, 8))), ended_at: at(d, hm(endMin)), edited: true, edit_comment: comment, edited_by: head, edited_at: editedAt });
        audit.push({ kindergarten_id: kg, actor_id: head, action: "worktime.edit", entity: "work_session", entity_id: id, details: { user_id: st.id, comment }, created_at: editedAt });
        continue;
      }
      const late = r < 0.1;
      const startMin = late ? s0 + rng.int(12, 40) : s0 - rng.int(0, 15);
      if (r < 0.14) {
        // A break in the middle of the day: two intervals.
        const mid = s0 + Math.round((e0 - s0) / 2);
        sessions.push({ ...base(st, d), id: uuid(), started_at: at(d, hm(startMin)), ended_at: at(d, hm(mid - 30)) });
        sessions.push({ ...base(st, d), id: uuid(), started_at: at(d, hm(mid + rng.int(0, 20))), ended_at: at(d, hm(e0 + rng.int(0, 15))) });
        continue;
      }
      sessions.push({ ...base(st, d), id: uuid(), started_at: at(d, hm(startMin)), ended_at: at(d, hm(e0 + rng.int(-5, 20))) });
    }
  }

  await insertMany(db, "staff_schedules", schedules);
  await insertMany(db, "schedule_overrides", overrides);
  await insertMany(db, "staff_absences", absences);
  await insertMany(db, "work_sessions", sessions, 1000);
  await insertMany(db, "audit_log", audit);
  return { autoClosed };
}

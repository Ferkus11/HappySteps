"use server";

import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { audit } from "@/lib/audit";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { ABSENCE_KINDS } from "@/lib/worktime";
import { zDate, zTime, zUuid, zOptionalText } from "@/lib/validation";

const ADMIN = ["owner", "head"] as const;

/** Start / finish: the time is taken by the database (`now()`), never from the client. */
export async function startDayAction() {
  return kgAction(STAFF_ROLES, async (ctx, supabase) => {
    check(await supabase.rpc("worktime_start", { kg: ctx.kg.id }));
  });
}

export async function finishDayAction() {
  return kgAction(STAFF_ROLES, async (ctx, supabase) => {
    check(await supabase.rpc("worktime_finish", { kg: ctx.kg.id }));
  });
}

const hhmm = (v: string) => v.slice(0, 5);

const scheduleSchema = z.object({
  userId: zUuid,
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        start: zTime,
        end: zTime,
      }),
    )
    .max(7)
    .refine((d) => d.every((x) => hhmm(x.end) > hhmm(x.start)), "worktimeTimeOrder")
    .refine((d) => new Set(d.map((x) => x.weekday)).size === d.length, "invalid"),
});

/** Replaces the weekly template; weekdays not listed are days off. */
export async function saveScheduleAction(input: z.input<typeof scheduleSchema>) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const v = parse(scheduleSchema, input);
    check(await supabase.from("staff_schedules").delete().eq("kindergarten_id", ctx.kg.id).eq("user_id", v.userId));
    if (v.days.length) {
      check(
        await supabase.from("staff_schedules").insert(
          v.days.map((d) => ({ kindergarten_id: ctx.kg.id, user_id: v.userId, weekday: d.weekday, start_time: d.start, end_time: d.end })),
        ),
      );
    }
    await audit(supabase, ctx.kg.id, "worktime.schedule", "person", v.userId, {
      days: v.days.map((d) => `${d.weekday}:${hhmm(d.start)}-${hhmm(d.end)}`),
    });
  });
}

const overrideSchema = z
  .object({
    userId: zUuid,
    date: zDate,
    kind: z.enum(["shift", "day_off"]),
    start: z.string().optional(),
    end: z.string().optional(),
    note: zOptionalText(500),
  })
  .superRefine((v, c) => {
    if (v.kind !== "shift") return;
    if (!v.start || !zTime.safeParse(v.start).success) c.addIssue({ code: "custom", path: ["start"], message: "required" });
    else if (!v.end || !zTime.safeParse(v.end).success) c.addIssue({ code: "custom", path: ["end"], message: "required" });
    else if (hhmm(v.end) <= hhmm(v.start)) c.addIssue({ code: "custom", path: ["end"], message: "worktimeTimeOrder" });
  });

/** One date differs from the template: substitution / short day (shift) or a day off. */
export async function setOverrideAction(input: z.input<typeof overrideSchema>) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const v = parse(overrideSchema, input);
    const row = {
      kindergarten_id: ctx.kg.id,
      user_id: v.userId,
      date: v.date,
      kind: v.kind,
      start_time: v.kind === "shift" ? v.start : null,
      end_time: v.kind === "shift" ? v.end : null,
      note: v.note,
      created_by: ctx.userId,
    };
    check(await supabase.from("schedule_overrides").upsert(row, { onConflict: "kindergarten_id,user_id,date" }));
    await audit(supabase, ctx.kg.id, "worktime.override", "person", v.userId, { date: v.date, kind: v.kind, start: row.start_time, end: row.end_time });
  });
}

export async function removeOverrideAction(id: string) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const oid = parse(zUuid, id);
    const rows = check(await supabase.from("schedule_overrides").delete().eq("id", oid).eq("kindergarten_id", ctx.kg.id).select("user_id, date"));
    if (!rows.length) throw new ActionError("notFound");
    await audit(supabase, ctx.kg.id, "worktime.override", "person", rows[0].user_id, { date: rows[0].date, removed: true });
  });
}

const absenceSchema = z
  .object({
    userId: zUuid,
    kind: z.enum(ABSENCE_KINDS),
    from: zDate,
    to: zDate,
    note: zOptionalText(500),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "dateInvalid" });

export async function addAbsenceAction(input: z.input<typeof absenceSchema>) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const v = parse(absenceSchema, input);
    const rows = check(
      await supabase
        .from("staff_absences")
        .insert({ kindergarten_id: ctx.kg.id, user_id: v.userId, kind: v.kind, date_from: v.from, date_to: v.to, note: v.note, created_by: ctx.userId })
        .select("id"),
    );
    await audit(supabase, ctx.kg.id, "worktime.absence", "person", v.userId, { id: rows[0]?.id, kind: v.kind, from: v.from, to: v.to });
  });
}

export async function removeAbsenceAction(id: string) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const aid = parse(zUuid, id);
    const rows = check(await supabase.from("staff_absences").delete().eq("id", aid).eq("kindergarten_id", ctx.kg.id).select("user_id, kind, date_from, date_to"));
    if (!rows.length) throw new ActionError("notFound");
    await audit(supabase, ctx.kg.id, "worktime.absence", "person", rows[0].user_id, { removed: true, kind: rows[0].kind, from: rows[0].date_from, to: rows[0].date_to });
  });
}

const comment = z.string().trim().min(3, "commentRequired").max(500, "tooLong");

const editSchema = z.object({
  id: zUuid,
  date: zDate,
  start: zTime,
  end: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || zTime.safeParse(v).success, "invalid"),
  comment,
});

/** Head/owner correction of an interval. The SQL function also requires the comment and writes the audit entry (`worktime.edit`). */
export async function editSessionAction(input: z.input<typeof editSchema>) {
  return kgAction([...ADMIN], async (_ctx, supabase) => {
    const v = parse(editSchema, input);
    if (v.end && hhmm(v.end) <= hhmm(v.start)) throw new ActionError("worktimeTimeOrder");
    check(await supabase.rpc("worktime_edit_session", { p_id: v.id, p_date: v.date, p_start: v.start, p_end: v.end, p_comment: v.comment }));
  });
}

const addSchema = z.object({ userId: zUuid, date: zDate, start: zTime, end: zTime, comment });

/** Head/owner adds a forgotten interval (comment required, audited as `worktime.edit`). */
export async function addSessionAction(input: z.input<typeof addSchema>) {
  return kgAction([...ADMIN], async (ctx, supabase) => {
    const v = parse(addSchema, input);
    if (hhmm(v.end) <= hhmm(v.start)) throw new ActionError("worktimeTimeOrder");
    check(
      await supabase.rpc("worktime_add_session", { kg: ctx.kg.id, p_user: v.userId, p_date: v.date, p_start: v.start, p_end: v.end, p_comment: v.comment }),
    );
  });
}

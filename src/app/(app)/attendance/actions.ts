"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { addDays, formatDate, todayIn } from "@/lib/format";
import { zDate, zUuid } from "@/lib/validation";
import { ABSENCE_REASONS } from "@/lib/attendance-logic";
import { loadGroupDay } from "@/lib/attendance";

const markSchema = z.object({
  groupId: zUuid,
  date: zDate,
  marks: z
    .array(z.object({ childId: zUuid, status: z.enum(["present", "absent"]) }))
    .min(1, "invalid")
    .max(200, "invalid"),
});

/** Teacher: own groups, today only. Owner/head: any group, any past day (audited by the DB trigger). */
export async function markAttendanceAction(input: z.input<typeof markSchema>) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    const v = parse(markSchema, input);
    const today = todayIn(ctx.settings.timezone);
    if (v.date > today) throw new ActionError("attendanceFuture");
    const admin = ctx.roles.includes("owner") || ctx.roles.includes("head");
    if (!admin && v.date !== today) throw new ActionError("attendanceLocked");
    // The roster function only answers for groups the caller may see.
    const { data: roster } = await supabase.rpc("attendance_roster", { p_group: v.groupId, p_from: v.date, p_to: v.date });
    const allowed = new Set(((roster ?? []) as { child_id: string }[]).map((r) => r.child_id));
    if (v.marks.some((m) => !allowed.has(m.childId))) throw new ActionError("forbidden");
    check(
      await supabase.from("child_attendance").upsert(
        v.marks.map((m) => ({ kindergarten_id: ctx.kg.id, child_id: m.childId, date: v.date, status: m.status })),
        { onConflict: "child_id,date" },
      ),
    );
  });
}

const allSchema = z.object({ groupId: zUuid, date: zDate });

/** "Все пришли": every child without a mark and without a parent's report becomes present. */
export async function markAllPresentAction(input: z.input<typeof allSchema>) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    const v = parse(allSchema, input);
    const day = await loadGroupDay(supabase, v.groupId, v.date);
    const marks = day.filter((c) => c.effective.status === "none").map((c) => ({ childId: c.id, status: "present" as const }));
    if (!marks.length) return { count: 0 };
    const r = await markAttendanceAction({ groupId: v.groupId, date: v.date, marks });
    if (!r.ok) throw new ActionError(r.error);
    return { count: marks.length };
  });
}

const reportSchema = z
  .object({
    childId: zUuid,
    from: zDate,
    to: zDate,
    reason: z.enum(ABSENCE_REASONS),
    comment: z
      .string()
      .max(500, "tooLong")
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : null)),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "dateInvalid" })
  .refine((v) => v.to <= addDays(v.from, 92), { path: ["to"], message: "dateInvalid" });

/** Parent ("Ребёнок не придёт") for own children; owner/head may report on a parent's behalf. */
export async function reportAbsenceAction(input: z.input<typeof reportSchema>) {
  return kgAction(["parent", "owner", "head"], async (ctx, supabase) => {
    const v = parse(reportSchema, input);
    const today = todayIn(ctx.settings.timezone);
    if (v.from < today) throw new ActionError("absencePast");
    const row = check(
      await supabase
        .from("absence_reports")
        .insert({ kindergarten_id: ctx.kg.id, child_id: v.childId, date_from: v.from, date_to: v.to, reason: v.reason, comment: v.comment })
        .select("id")
        .single(),
    );
    // Permission is proven by the insert (RLS). Tell the teachers of the child's group.
    const { data: child } = await supabase.from("children").select("full_name, group_id").eq("id", v.childId).maybeSingle();
    if (child?.group_id) {
      const { data: teachers } = await supabase.from("group_teachers").select("user_id").eq("group_id", child.group_id);
      await notify({
        kindergartenId: ctx.kg.id,
        userIds: (teachers ?? []).map((t) => t.user_id as string),
        type: "absence.reported",
        params: { child: child.full_name, reason: v.reason, period: v.from === v.to ? formatDate(v.from) : `${formatDate(v.from)} — ${formatDate(v.to)}` },
        url: `/attendance?group=${child.group_id}`,
      });
    }
    return { id: row.id as string, reason: v.reason };
  });
}

export async function cancelAbsenceAction(id: string) {
  return kgAction(["parent", "owner", "head"], async (ctx, supabase) => {
    const reportId = parse(zUuid, id);
    check(await supabase.rpc("cancel_absence_report", { p_id: reportId }));
    if (ctx.role !== "parent") await audit(supabase, ctx.kg.id, "attendance.absence_cancel", "absence_report", reportId);
  });
}

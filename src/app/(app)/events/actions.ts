"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { AUDIENCES, assertTargets, syncGroups } from "@/lib/audience";
import { EVENT_KINDS } from "@/lib/events";
import { zDate, zOptionalText, zUuid } from "@/lib/validation";

const zOptTime = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{2}:\d{2}(:\d{2})?$/.test(v), "invalid");

const schema = z
  .object({
    title: z.string().trim().min(1, "required").max(200, "tooLong"),
    kind: z.enum(EVENT_KINDS),
    date: zDate,
    startTime: zOptTime,
    endTime: zOptTime,
    place: zOptionalText(200),
    description: zOptionalText(5000),
    audience: z.enum(AUDIENCES),
    groupIds: z.array(zUuid).max(100).default([]),
  })
  .refine((v) => !v.endTime || (v.startTime && v.endTime >= v.startTime), { path: ["endTime"], message: "endBeforeStart" });

export type EventInput = z.input<typeof schema>;

const row = (v: z.infer<typeof schema>) => ({
  title: v.title,
  kind: v.kind,
  date: v.date,
  start_time: v.startTime,
  end_time: v.endTime,
  place: v.place,
  description: v.description,
  audience: v.audience,
});

export async function createEventAction(input: EventInput) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    const v = parse(schema, input);
    const groupIds = await assertTargets(supabase, ctx, v.audience, v.groupIds);
    const created = check(await supabase.from("events").insert({ kindergarten_id: ctx.kg.id, author_id: ctx.userId, ...row(v) }).select("id").single());
    try {
      await syncGroups(supabase, "event_groups", "event_id", created.id, ctx.kg.id, groupIds);
    } catch (e) {
      await supabase.from("events").delete().eq("id", created.id);
      throw e;
    }
    await syncDayOff(supabase, ctx.kg.id, v);
    return { id: created.id as string, date: v.date };
  });
}

/**
 * "Выходной день сада" must also stop attendance/work-time expectations, which read the holidays table
 * (single source of truth for days off, D-022). Owner/head only — enforced by the events policies too.
 */
async function syncDayOff(supabase: SupabaseClient, kgId: string, v: { kind: string; date: string; title: string }) {
  if (v.kind !== "day_off") return;
  check(
    await supabase
      .from("holidays")
      .upsert({ kindergarten_id: kgId, date: v.date, name: v.title.slice(0, 120), kind: "day_off" }, { onConflict: "kindergarten_id,date" }),
  );
}

export async function updateEventAction(id: string, input: EventInput) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(schema, input);
    const groupIds = await assertTargets(supabase, ctx, v.audience, v.groupIds);
    const updated = check(await supabase.from("events").update(row(v)).eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id"));
    if (!updated.length) throw new ActionError("forbidden");
    await syncGroups(supabase, "event_groups", "event_id", id, ctx.kg.id, groupIds);
    await syncDayOff(supabase, ctx.kg.id, v);
    return { id, date: v.date };
  });
}

export async function deleteEventAction(id: string) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const deleted = check(await supabase.from("events").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id, title, date"));
    if (!deleted.length) throw new ActionError("forbidden");
    await audit(supabase, ctx.kg.id, "event.delete", "event", id, { title: deleted[0].title, date: deleted[0].date });
  });
}

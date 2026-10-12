"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { audit } from "@/lib/audit";
import { zColor, zDate, zUuid } from "@/lib/validation";

const groupSchema = z.object({
  name: z.string().trim().min(1, "required").max(80, "tooLong"),
  ageCategory: z.string().trim().max(80, "tooLong").optional().transform((v) => v || null),
  capacity: z.coerce.number({ message: "numberInvalid" }).int("numberInvalid").min(1, "numberInvalid").max(200, "numberInvalid"),
  color: zColor,
  teacherIds: z.array(zUuid).default([]),
});

export async function saveGroupAction(id: string | null, input: z.input<typeof groupSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(groupSchema, input);
    const row = { name: v.name, age_category: v.ageCategory, capacity: v.capacity, color: v.color, kindergarten_id: ctx.kg.id };
    const saved = id
      ? check(await supabase.from("groups").update(row).eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id").single())
      : check(await supabase.from("groups").insert(row).select("id").single());
    check(await supabase.from("group_teachers").delete().eq("group_id", saved.id));
    if (v.teacherIds.length) {
      check(
        await supabase
          .from("group_teachers")
          .insert(v.teacherIds.map((u) => ({ group_id: saved.id, user_id: u, kindergarten_id: ctx.kg.id }))),
      );
    }
    await audit(supabase, ctx.kg.id, id ? "group.update" : "group.create", "group", saved.id, { name: v.name });
    return { id: saved.id as string };
  });
}

export async function deleteGroupAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const deleted = check(await supabase.from("groups").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id, name"));
    if (deleted.length) await audit(supabase, ctx.kg.id, "group.delete", "group", id, { name: deleted[0].name });
  });
}

export async function transferGroupAction(fromId: string, toId: string, date: string) {
  return kgAction(["owner", "head"], async (_ctx, supabase) => {
    zUuid.parse(fromId);
    zUuid.parse(toId);
    zDate.parse(date);
    const n = check(await supabase.rpc("transfer_group", { p_from: fromId, p_to: toId, p_date: date }));
    return { count: n as unknown as number };
  });
}

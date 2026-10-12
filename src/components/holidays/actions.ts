"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { audit } from "@/lib/audit";
import { kzHolidays } from "@/lib/holidays-kz";
import { zDate, zUuid } from "@/lib/validation";

export async function fillKzHolidaysAction(year: number) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const y = z.number().int().min(2024).max(2100).parse(year);
    const locale = ctx.settings.default_locale;
    const rows = kzHolidays(y).map((h) => ({ kindergarten_id: ctx.kg.id, date: h.date, name: h.name[locale], kind: "holiday" }));
    const inserted = check(await supabase.from("holidays").upsert(rows, { onConflict: "kindergarten_id,date", ignoreDuplicates: true }).select("id"));
    await audit(supabase, ctx.kg.id, "holidays.update", "holidays", String(y), { filled: inserted.length });
    return { count: inserted.length };
  });
}

const addSchema = z.object({
  date: zDate,
  name: z.string().trim().min(1, "required").max(120, "tooLong"),
  kind: z.enum(["holiday", "day_off", "working_day"]),
});

export async function addHolidayAction(input: z.input<typeof addSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(addSchema, input);
    check(await supabase.from("holidays").upsert({ kindergarten_id: ctx.kg.id, ...v }, { onConflict: "kindergarten_id,date" }));
    await audit(supabase, ctx.kg.id, "holidays.update", "holidays", v.date, { name: v.name, kind: v.kind });
  });
}

export async function removeHolidayAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    check(await supabase.from("holidays").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id));
    await audit(supabase, ctx.kg.id, "holidays.update", "holidays", id, { removed: true });
  });
}

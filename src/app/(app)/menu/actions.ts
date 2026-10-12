"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { zDate } from "@/lib/validation";
import { MENU_EDITORS } from "@/components/menu/data";
import { MEALS, enabledMeals } from "@/components/menu/meals";

const itemSchema = z.object({
  meal: z.enum(MEALS),
  dish: z.string().trim().min(1, "required").max(200, "tooLong"),
  composition: z
    .string()
    .max(500, "tooLong")
    .optional()
    .transform((v) => (v ?? "").replace(/[\r\n]+/g, " ").trim()),
});

const saveSchema = z.object({
  date: zDate,
  items: z.array(itemSchema).max(60, "tooLong"),
});

/** Replaces the whole day (empty list clears it). Only enabled meals are accepted. */
export async function saveMenuAction(input: z.input<typeof saveSchema>) {
  return kgAction(MENU_EDITORS, async (ctx, supabase) => {
    const v = parse(saveSchema, input);
    const meals = enabledMeals(ctx.settings.meals);
    if (v.items.some((i) => !meals.includes(i.meal))) throw new ActionError("invalid");
    check(await supabase.rpc("save_menu", { p_kg: ctx.kg.id, p_date: v.date, p_items: v.items }));
  });
}

const copySchema = z.object({ from: zDate, to: zDate }).refine((v) => v.from !== v.to, { message: "invalid", path: ["from"] });

/** Copies the dishes of `from` into `to`, replacing what `to` had. */
export async function copyMenuAction(input: z.input<typeof copySchema>) {
  return kgAction(MENU_EDITORS, async (ctx, supabase) => {
    const v = parse(copySchema, input);
    const meals = enabledMeals(ctx.settings.meals);
    const src = check(
      await supabase
        .from("menus")
        .select("menu_items(meal, dish, composition, position)")
        .eq("kindergarten_id", ctx.kg.id)
        .eq("date", v.from)
        .maybeSingle(),
    ) as { menu_items: { meal: string; dish: string; composition: string | null; position: number }[] } | null;
    const items = (src?.menu_items ?? [])
      .filter((i) => (meals as string[]).includes(i.meal))
      .sort((a, b) => MEALS.indexOf(a.meal as (typeof MEALS)[number]) - MEALS.indexOf(b.meal as (typeof MEALS)[number]) || a.position - b.position)
      .map(({ meal, dish, composition }) => ({ meal, dish, composition }));
    if (!items.length) throw new ActionError("menuSourceEmpty");
    check(await supabase.rpc("save_menu", { p_kg: ctx.kg.id, p_date: v.to, p_items: items }));
    return { count: items.length };
  });
}

export async function clearMenuAction(date: string) {
  return kgAction(MENU_EDITORS, async (ctx, supabase) => {
    const d = parse(zDate, date);
    check(await supabase.rpc("save_menu", { p_kg: ctx.kg.id, p_date: d, p_items: [] }));
  });
}

const mealsSchema = z.object({ meals: z.array(z.enum(MEALS)).min(1, "required") });

/** Settings card «Приёмы пищи» (owner/head; RLS on kindergarten_settings agrees). */
export async function setMealsAction(input: z.input<typeof mealsSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(mealsSchema, input);
    const meals = MEALS.filter((m) => v.meals.includes(m));
    const rows = check(await supabase.from("kindergarten_settings").update({ meals }).eq("kindergarten_id", ctx.kg.id).select("kindergarten_id"));
    if (!rows.length) throw new ActionError("forbidden");
    await audit(supabase, ctx.kg.id, "kindergarten.settings", "kindergarten", ctx.kg.id, { section: "meals", meals });
  });
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { setMealsAction } from "@/app/(app)/menu/actions";
import { MEALS, type MealKey } from "./meals";

export function MealsSwitches({ value }: { value: MealKey[] }) {
  const t = useTranslations("menu");
  const [meals, setMeals] = React.useState<MealKey[]>(value);
  const save = useAction(setMealsAction, { success: t("mealsCard.saved") });
  const toggle = async (m: MealKey, on: boolean) => {
    const prev = meals;
    const next = on ? MEALS.filter((x) => x === m || prev.includes(x)) : prev.filter((x) => x !== m);
    if (!next.length) return;
    setMeals(next);
    const r = await save.run({ meals: next });
    if (!r?.ok) setMeals(prev);
  };
  return (
    <ul className="divide-y divide-border">
      {MEALS.map((m) => {
        const on = meals.includes(m);
        const last = on && meals.length === 1;
        return (
          <li key={m}>
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-[15px]">
              <span>
                {t(`meals.${m}`)}
                {last ? <span className="block text-[13px] text-faint">{t("mealsCard.lastOne")}</span> : null}
              </span>
              <Switch
                checked={on}
                disabled={last || save.pending}
                onCheckedChange={(v) => void toggle(m, v)}
                data-testid={`meal-switch-${m}`}
                aria-label={t(`meals.${m}`)}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { Card, CardHeader } from "@/components/ui/card";
import { enabledMeals } from "./meals";
import { MealsSwitches } from "./meals-switches";

/** Settings section «Приёмы пищи» (owner/head). */
export async function MealsCard() {
  const ctx = await requireKg(["owner", "head"]);
  const t = await getTranslations("menu.mealsCard");
  return (
    <Card data-testid="meals-card">
      <CardHeader title={t("title")} />
      <p className="-mt-2 mb-3 text-sm text-muted">{t("hint")}</p>
      <MealsSwitches value={enabledMeals(ctx.settings.meals)} />
    </Card>
  );
}

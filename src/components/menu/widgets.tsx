import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil, UtensilsCrossed } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIn } from "@/lib/format";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AllergiesCard } from "./allergies-card";
import { loadMenus } from "./data";
import { dayTitle, MealList } from "./day-menu";
import { enabledMeals, groupByMeal } from "./meals";

/** «Меню на сегодня» for everybody except the cook: meal → dishes in one line. */
async function MenuToday({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("menu");
  const today = todayIn(ctx.settings.timezone);
  const menu = (await loadMenus(await createClient(), ctx.kg.id, [today]))[today];
  const meals = enabledMeals(ctx.settings.meals);
  const filled = groupByMeal(menu.items, meals).length > 0;
  return (
    <Card className="h-full" data-testid="menu-today">
      <CardHeader title={t("todayWidget")} href="/menu" />
      {filled ? (
        <MealList menu={menu} meals={meals} compact />
      ) : (
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-soft text-sky-strong">
            <UtensilsCrossed className="size-5" aria-hidden />
          </span>
          {t("empty")}
        </div>
      )}
    </Card>
  );
}

/** Cook: today + tomorrow side by side with the edit button. */
async function KitchenMenu({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("menu");
  const today = todayIn(ctx.settings.timezone);
  const dates = [today, addDays(today, 1)];
  const menus = await loadMenus(await createClient(), ctx.kg.id, dates);
  const meals = enabledMeals(ctx.settings.meals);
  return (
    <Card data-testid="menu-kitchen">
      <CardHeader
        title={t("kitchenWidget")}
        href="/menu"
        action={
          <Button asChild size="sm" variant="secondary" data-testid="menu-kitchen-edit">
            <Link href={`/menu/edit?date=${today}`}>
              <Pencil /> {t("edit")}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-5 md:grid-cols-2 md:gap-6">
        {await Promise.all(
          dates.map(async (d) => {
            const filled = groupByMeal(menus[d].items, meals).length > 0;
            return (
              <section key={d} className="min-w-0" data-testid={`menu-kitchen-${d === today ? "today" : "tomorrow"}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className={d === today ? "text-sm font-bold text-brand" : "text-sm font-bold text-muted"}>{await dayTitle(d, today)}</h3>
                  {!filled ? (
                    <Link href={`/menu/edit?date=${d}`} className="text-sm font-semibold text-brand hover:underline">
                      {t("fill")}
                    </Link>
                  ) : null}
                </div>
                {filled ? <MealList menu={menus[d]} meals={meals} compact /> : <p className="rounded-xl bg-surface-muted px-3 py-3 text-sm text-muted">{t("emptyEditor")}</p>}
              </section>
            );
          }),
        )}
      </div>
    </Card>
  );
}

export const menuWidgets: DashboardWidget[] = [
  { id: "menu-today", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "parent"], slot: "main", order: 30, Component: MenuToday },
  { id: "menu-kitchen", roles: ["cook"], slot: "top", order: 20, Component: KitchenMenu },
  { id: "menu-allergies", roles: ["cook"], slot: "main", order: 25, Component: AllergiesCard },
];

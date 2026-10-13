import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, isoWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { groupByMeal, relativeDay, type DayMenu, type MealKey } from "./meals";

/** "Сегодня · 12.10.2026" / "Четверг · 15.10.2026". */
export async function dayTitle(date: string, today: string) {
  const t = await getTranslations("menu");
  const rel = relativeDay(date, today);
  return `${rel ? t(rel) : t(`weekdays.${isoWeekday(date)}`)} · ${formatDate(date)}`;
}

/** Dishes of one day grouped by meal. `compact` = one line per meal (dashboard). */
export async function MealList({ menu, meals, compact }: { menu: DayMenu; meals: MealKey[]; compact?: boolean }) {
  const t = await getTranslations("menu");
  const groups = groupByMeal(menu.items, meals);
  if (compact) {
    return (
      <ul className="divide-y divide-border">
        {groups.map((g) => (
          <li key={g.meal} className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <span className="w-28 shrink-0 text-muted">{t(`meals.${g.meal}`)}</span>
            <span className="min-w-0 flex-1 font-semibold break-words" data-user-content>
              {g.dishes.map((d) => d.dish).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.meal} data-testid={`menu-meal-${g.meal}`}>
          <h3 className="mb-1.5 text-xs font-bold tracking-wide text-sky-strong uppercase">{t(`meals.${g.meal}`)}</h3>
          <ul className="space-y-1.5">
            {g.dishes.map((d, i) => (
              <li key={i} className="rounded-xl bg-surface-muted px-3 py-2">
                <div data-user-content className="text-[15px] font-semibold break-words">{d.dish}</div>
                {d.composition ? <div data-user-content className="mt-0.5 text-[13px] break-words text-muted">{d.composition}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Card with one day's menu (or the empty state). */
export async function DayMenuCard({
  menu,
  meals,
  today,
  canEdit,
  className,
}: {
  menu: DayMenu;
  meals: MealKey[];
  today: string;
  canEdit: boolean;
  className?: string;
}) {
  const t = await getTranslations("menu");
  const hasItems = groupByMeal(menu.items, meals).length > 0;
  const editHref = `/menu/edit?date=${menu.date}`;
  const isToday = menu.date === today;
  return (
    <Card className={cn("min-w-0", className)} data-testid={`menu-day-${menu.date}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={cn("text-[15px] font-bold", isToday ? "text-brand" : "text-text")}>{await dayTitle(menu.date, today)}</h2>
        {canEdit && hasItems ? (
          <Button asChild variant="ghost" size="sm" data-testid="menu-edit">
            <Link href={editHref}>
              <Pencil /> {t("edit")}
            </Link>
          </Button>
        ) : null}
      </div>
      {hasItems ? (
        <MealList menu={menu} meals={meals} />
      ) : (
        <EmptyState
          className="py-6"
          icon={UtensilsCrossed}
          title={canEdit ? t("emptyEditor") : t("empty")}
          hint={canEdit ? undefined : t("emptyHint")}
          action={
            canEdit ? (
              <Button asChild data-testid="menu-fill">
                <Link href={editHref}>{t("fill")}</Link>
              </Button>
            ) : null
          }
        />
      )}
    </Card>
  );
}

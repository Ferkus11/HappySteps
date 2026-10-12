/** Meal keys in display order (same values as kindergarten_settings.meals and menu_items.meal). */
export const MEALS = ["breakfast", "second_breakfast", "lunch", "snack", "dinner"] as const;
export type MealKey = (typeof MEALS)[number];

export interface MenuItem {
  meal: MealKey;
  dish: string;
  composition: string | null;
  position: number;
}

export interface DayMenu {
  date: string;
  updatedAt: string | null;
  items: MenuItem[];
}

export function isMeal(v: unknown): v is MealKey {
  return typeof v === "string" && (MEALS as readonly string[]).includes(v);
}

/** Enabled meals of a kindergarten in canonical order (unknown keys are dropped). */
export function enabledMeals(settingsMeals: readonly string[] | null | undefined): MealKey[] {
  const set = new Set(settingsMeals ?? []);
  return MEALS.filter((m) => set.has(m));
}

/**
 * Groups a day's items by meal for display: only enabled meals, in canonical order,
 * dishes sorted by position; meals without dishes are omitted.
 */
export function groupByMeal(items: readonly MenuItem[], meals: readonly MealKey[]): { meal: MealKey; dishes: MenuItem[] }[] {
  return meals
    .map((meal) => ({
      meal,
      dishes: items.filter((i) => i.meal === meal).sort((a, b) => a.position - b.position),
    }))
    .filter((g) => g.dishes.length > 0);
}

/** "today" / "tomorrow" / "yesterday" relative to `today`, else null. Dates are YYYY-MM-DD. */
export function relativeDay(date: string, today: string): "today" | "tomorrow" | "yesterday" | null {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return null;
}

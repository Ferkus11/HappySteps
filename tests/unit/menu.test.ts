import { describe, expect, it } from "vitest";
import { enabledMeals, groupByMeal, relativeDay, type MenuItem } from "@/components/menu/meals";

describe("menu helpers", () => {
  it("enabledMeals keeps canonical order and drops unknown keys", () => {
    expect(enabledMeals(["lunch", "breakfast", "brunch", "dinner"])).toEqual(["breakfast", "lunch", "dinner"]);
    expect(enabledMeals(null)).toEqual([]);
  });

  it("groupByMeal shows only enabled meals with dishes, sorted by position", () => {
    const items: MenuItem[] = [
      { meal: "lunch", dish: "Плов", composition: null, position: 1 },
      { meal: "lunch", dish: "Суп", composition: "курица", position: 0 },
      { meal: "snack", dish: "Кефир", composition: null, position: 0 },
      { meal: "breakfast", dish: "Каша", composition: null, position: 0 },
    ];
    const g = groupByMeal(items, ["breakfast", "second_breakfast", "lunch"]);
    expect(g.map((x) => x.meal)).toEqual(["breakfast", "lunch"]);
    expect(g[1].dishes.map((d) => d.dish)).toEqual(["Суп", "Плов"]);
  });

  it("relativeDay names today, tomorrow and yesterday across month borders", () => {
    expect(relativeDay("2026-10-31", "2026-10-31")).toBe("today");
    expect(relativeDay("2026-11-01", "2026-10-31")).toBe("tomorrow");
    expect(relativeDay("2026-10-30", "2026-10-31")).toBe("yesterday");
    expect(relativeDay("2026-11-02", "2026-10-31")).toBeNull();
  });
});

/**
 * Menu fixtures for kindergarten A: a few past days (never today/tomorrow, so e2e starts clean). Idempotent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

const DAYS: { breakfast: [string, string]; lunch: [string, string][]; snack: [string, string] }[] = [
  {
    breakfast: ["Каша овсяная молочная", "овсяные хлопья, молоко, сливочное масло, сахар"],
    lunch: [
      ["Суп куриный с вермишелью", "курица, вермишель, морковь, лук"],
      ["Плов с говядиной", "рис, говядина, морковь, лук"],
    ],
    snack: ["Сырники со сметаной", "творог, яйцо, мука, сметана"],
  },
  {
    breakfast: ["Каша рисовая", "рис, молоко, сахар"],
    lunch: [
      ["Борщ", "свёкла, капуста, картофель, говядина"],
      ["Котлета с пюре", "говядина, картофель, молоко"],
    ],
    snack: ["Кефир и печенье", "кефир, печенье"],
  },
  {
    breakfast: ["Омлет", "яйцо, молоко"],
    lunch: [
      ["Суп гороховый", "горох, картофель, морковь"],
      ["Тефтели с гречкой", "говядина, рис, гречка"],
    ],
    snack: ["Запеканка творожная", "творог, манка, яйцо"],
  },
];

function isoInAlmaty(offsetDays: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function seedMenu(db: SupabaseClient, ids: { A: string }) {
  for (let i = 0; i < DAYS.length; i++) {
    const day = DAYS[i];
    const date = isoInAlmaty(-(i + 2)); // 2, 3, 4 days ago
    const menu = must(
      await db.from("menus").upsert({ kindergarten_id: ids.A, date }, { onConflict: "kindergarten_id,date" }).select("id").single(),
      "menu",
    );
    must(await db.from("menu_items").delete().eq("menu_id", menu.id), "menu items cleanup");
    const items = [
      { meal: "breakfast", dish: day.breakfast[0], composition: day.breakfast[1], position: 0 },
      ...day.lunch.map(([dish, composition], p) => ({ meal: "lunch", dish, composition, position: p })),
      { meal: "snack", dish: day.snack[0], composition: day.snack[1], position: 0 },
    ].map((x) => ({ ...x, menu_id: menu.id, kindergarten_id: ids.A }));
    must(await db.from("menu_items").insert(items), "menu items");
  }
}

import { beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { inTx, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const DAY = "2030-03-04";

/** Creates a menu with one item in kindergarten `kg` as superuser; returns ids. */
async function makeMenu(c: PoolClient, kg: string, date = DAY) {
  const m = await c.query("insert into menus (kindergarten_id, date) values ($1, $2) returning id", [kg, date]);
  const i = await c.query("insert into menu_items (menu_id, kindergarten_id, meal, dish) values ($1, $2, 'lunch', 'Борщ') returning id", [m.rows[0].id, kg]);
  return { menu: m.rows[0].id as string, item: i.rows[0].id as string };
}

describe("menu visibility", () => {
  it("every member of the kindergarten reads the menu; other kindergartens see nothing", async () => {
    await inTx(async (c, become) => {
      await makeMenu(c, F.A);
      for (const who of ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent"] as Who[]) {
        await become(F.users[who]);
        expect((await c.query("select 1 from menus where date = $1", [DAY])).rowCount, who).toBe(1);
        expect((await c.query("select 1 from menu_items i join menus m on m.id = i.menu_id where m.date = $1", [DAY])).rowCount, who).toBe(1);
      }
      for (const who of ["ownerB", "parentB"] as Who[]) {
        await become(F.users[who]);
        expect((await c.query("select 1 from menus where kindergarten_id = $1", [F.A])).rowCount, who).toBe(0);
        expect((await c.query("select 1 from menu_items where kindergarten_id = $1", [F.A])).rowCount, who).toBe(0);
      }
      await become(null);
      expect((await c.query("select 1 from menus")).rowCount).toBe(0);
    });
  });
});

describe("menu writes", () => {
  it("parent, teacher, accountant and club teacher cannot insert, update or delete", async () => {
    for (const who of ["parent", "teacher", "accountant", "clubTeacher", "teacherParent"] as Who[]) {
      await inTx(async (c, become) => {
        const ids = await makeMenu(c, F.A);
        await become(F.users[who]);
        expect(await rejects(c, "insert into menus (kindergarten_id, date) values ($1, '2030-03-05')", [F.A]), who).toBe(true);
        expect(
          await rejects(c, "insert into menu_items (menu_id, kindergarten_id, meal, dish) values ($1, $2, 'snack', 'Кефир')", [ids.menu, F.A]),
          who,
        ).toBe(true);
        expect((await c.query("update menu_items set dish = 'Взлом' where id = $1", [ids.item])).rowCount, who).toBe(0);
        expect((await c.query("delete from menu_items where id = $1", [ids.item])).rowCount, who).toBe(0);
        expect((await c.query("delete from menus where id = $1", [ids.menu])).rowCount, who).toBe(0);
        expect(await rejects(c, "select save_menu($1, '2030-03-05', '[{\"meal\":\"lunch\",\"dish\":\"x\"}]'::jsonb)", [F.A]), who).toBe(true);
        expect(await rejects(c, "select save_menu($1, $2, '[]'::jsonb)", [F.A, DAY]), who).toBe(true);
        await become(null);
        await c.query("reset role");
        expect((await c.query("select dish from menu_items where id = $1", [ids.item])).rows[0].dish).toBe("Борщ");
      });
    }
  });

  it("cook, head and owner edit the menu of their own kindergarten", async () => {
    for (const who of ["cook", "head", "owner"] as Who[]) {
      await inTx(async (c, become) => {
        await become(F.users[who]);
        const m = await c.query("insert into menus (kindergarten_id, date) values ($1, $2) returning id, updated_by", [F.A, DAY]);
        expect(m.rows[0].updated_by, who).toBe(F.users[who]);
        const i = await c.query("insert into menu_items (menu_id, kindergarten_id, meal, dish, composition) values ($1, $2, 'breakfast', 'Каша', 'овсянка, молоко') returning id", [
          m.rows[0].id,
          F.A,
        ]);
        expect((await c.query("update menu_items set dish = 'Каша рисовая' where id = $1", [i.rows[0].id])).rowCount).toBe(1);
        expect((await c.query("delete from menu_items where id = $1", [i.rows[0].id])).rowCount).toBe(1);
        expect((await c.query("delete from menus where id = $1", [m.rows[0].id])).rowCount).toBe(1);
        // Not in another kindergarten.
        expect(await rejects(c, "insert into menus (kindergarten_id, date) values ($1, $2)", [F.B, DAY])).toBe(true);
        expect(await rejects(c, "select save_menu($1, $2, '[{\"meal\":\"lunch\",\"dish\":\"x\"}]'::jsonb)", [F.B, DAY])).toBe(true);
      });
    }
  });

  it("save_menu replaces the whole day atomically and an empty list clears it", async () => {
    await inTx(async (c, become) => {
      await become(F.users.cook);
      const items = [
        { meal: "breakfast", dish: " Каша ", composition: "овсянка" },
        { meal: "lunch", dish: "Суп" },
        { meal: "breakfast", dish: "Чай", composition: "" },
      ];
      await c.query("select save_menu($1, $2, $3::jsonb)", [F.A, DAY, JSON.stringify(items)]);
      await c.query("select save_menu($1, $2, $3::jsonb)", [F.A, DAY, JSON.stringify(items)]);
      const r = await c.query(
        "select meal, dish, composition, position from menu_items i join menus m on m.id = i.menu_id where m.kindergarten_id = $1 and m.date = $2 order by meal, position",
        [F.A, DAY],
      );
      expect(r.rows).toEqual([
        { meal: "breakfast", dish: "Каша", composition: "овсянка", position: 0 },
        { meal: "breakfast", dish: "Чай", composition: null, position: 1 },
        { meal: "lunch", dish: "Суп", composition: null, position: 0 },
      ]);
      // invalid meal → whole call fails, nothing half-written
      expect(await rejects(c, "select save_menu($1, $2, '[{\"meal\":\"brunch\",\"dish\":\"x\"}]'::jsonb)", [F.A, DAY])).toBe(true);
      expect((await c.query("select 1 from menu_items i join menus m on m.id = i.menu_id where m.date = $1", [DAY])).rowCount).toBe(3);
      await c.query("select save_menu($1, $2, '[]'::jsonb)", [F.A, DAY]);
      expect((await c.query("select 1 from menus where kindergarten_id = $1 and date = $2", [F.A, DAY])).rowCount).toBe(0);
    });
  });

  it("composition is one line; the date and kindergarten of a menu cannot be changed", async () => {
    await inTx(async (c, become) => {
      const ids = await makeMenu(c, F.A);
      await become(F.users.cook);
      expect(await rejects(c, "update menu_items set composition = E'a\\nb' where id = $1", [ids.item])).toBe(true);
      expect(await rejects(c, "update menus set date = '2030-03-06' where id = $1", [ids.menu])).toBe(true);
      expect(await rejects(c, "update menus set kindergarten_id = $1 where id = $2", [F.B, ids.menu])).toBe(true);
    });
  });
});

describe("menu integrity", () => {
  it("a menu item must belong to a menu of the same kindergarten", async () => {
    await inTx(async (c, become) => {
      const a = await makeMenu(c, F.A);
      const b = await makeMenu(c, F.B);
      // even as superuser the trigger rejects a cross-tenant link
      expect(await rejects(c, "insert into menu_items (menu_id, kindergarten_id, meal, dish) values ($1, $2, 'lunch', 'x')", [b.menu, F.A])).toBe(true);
      await become(F.users.cook);
      expect(await rejects(c, "insert into menu_items (menu_id, kindergarten_id, meal, dish) values ($1, $2, 'lunch', 'x')", [b.menu, F.A])).toBe(true);
      expect(await rejects(c, "update menu_items set menu_id = $1 where id = $2", [b.menu, a.item])).toBe(true);
      // ownerB cannot attach items to A's menu
      await become(F.users.ownerB);
      expect(await rejects(c, "insert into menu_items (menu_id, kindergarten_id, meal, dish) values ($1, $2, 'lunch', 'x')", [a.menu, F.B])).toBe(true);
    });
  });

  it("one menu per kindergarten and date", async () => {
    await inTx(async (c) => {
      await makeMenu(c, F.A);
      expect(await rejects(c, "insert into menus (kindergarten_id, date) values ($1, $2)", [F.A, DAY])).toBe(true);
      await c.query("insert into menus (kindergarten_id, date) values ($1, $2)", [F.B, DAY]);
    });
  });

  it("head may switch meals in settings; teacher and cook may not", async () => {
    await inTx(async (c, become) => {
      await become(F.users.head);
      expect((await c.query("update kindergarten_settings set meals = array['breakfast','lunch'] where kindergarten_id = $1", [F.A])).rowCount).toBe(1);
      for (const who of ["teacher", "cook", "accountant"] as Who[]) {
        await become(F.users[who]);
        expect((await c.query("update kindergarten_settings set meals = array['lunch'] where kindergarten_id = $1", [F.A])).rowCount, who).toBe(0);
      }
    });
  });
});

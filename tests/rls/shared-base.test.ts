import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

describe("holidays", () => {
  it("only owner/head of the kindergarten edit holidays; members read them", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect(await rejects(c, "insert into holidays (kindergarten_id, date, name) values ($1, '2030-01-01', 'x')", [F.A])).toBe(true);
      await become(F.users.head);
      await c.query("insert into holidays (kindergarten_id, date, name) values ($1, '2030-01-01', 'Новый год')", [F.A]);
      expect(await rejects(c, "insert into holidays (kindergarten_id, date, name) values ($1, '2030-01-01', 'x')", [F.B])).toBe(true);
      await become(F.users.parent);
      expect((await c.query("select 1 from holidays where kindergarten_id = $1", [F.A])).rowCount).toBe(1);
      await become(F.users.ownerB);
      expect((await c.query("select 1 from holidays where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
    });
  });
  it("kg_is_working_day honours weekends, holidays and transferred working days", async () => {
    await inTx(async (c) => {
      await c.query("insert into holidays (kindergarten_id, date, name, kind) values ($1, '2030-01-01', 'НГ', 'holiday'), ($1, '2030-01-05', 'Перенос', 'working_day')", [F.A]);
      const q = async (d: string) => (await c.query("select kg_is_working_day($1, $2::date) as w", [F.A, d])).rows[0].w;
      expect(await q("2030-01-01")).toBe(false); // holiday (Tuesday)
      expect(await q("2030-01-02")).toBe(true); // Wednesday
      expect(await q("2030-01-05")).toBe(true); // Saturday, working
      expect(await q("2030-01-06")).toBe(false); // Sunday
    });
  });
});

describe("notifications", () => {
  it("users see and mark only their own notifications and cannot create them", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into notifications (kindergarten_id, user_id, type) values ($1, $2, 'announcement.new'), ($1, $3, 'announcement.new')", [
        F.A,
        F.users.parent,
        F.users.teacher,
      ]);
      await become(F.users.parent);
      // Other modules create notifications too — the point is that only own rows are visible.
      const own = (await c.query("select distinct user_id from notifications")).rows.map((r) => r.user_id);
      expect(own).toEqual([F.users.parent]);
      expect((await c.query("update notifications set read_at = now() where user_id = $1", [F.users.parent])).rowCount).toBeGreaterThanOrEqual(1);
      expect((await c.query("update notifications set read_at = now() where user_id = $1", [F.users.teacher])).rowCount).toBe(0);
      expect(await rejects(c, "update notifications set type = 'x'")).toBe(true);
      expect(await rejects(c, "insert into notifications (user_id, type) values ($1, 'x')", [F.users.parent])).toBe(true);
    });
  });
});

describe("anonymous", () => {
  it("reads no holidays", async () => {
    await asUser(null, async (c) => {
      expect(await rejects(c, "select * from holidays")).toBe(false);
      expect((await c.query("select 1 from holidays")).rowCount).toBe(0);
    });
  });
});

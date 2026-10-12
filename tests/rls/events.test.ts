import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

async function createEvent(c: PoolClient, become: (u: string | null) => Promise<void>, who: Who, audience: string, groups: string[] = [], date = "2030-03-10") {
  await become(F.users[who]);
  const id = (
    await c.query("insert into events (kindergarten_id, author_id, audience, kind, title, date) values ($1, $2, $3, 'matinee', 'Утренник', $4) returning id", [
      F.A,
      F.users[who],
      audience,
      date,
    ])
  ).rows[0].id as string;
  for (const g of groups) await c.query("insert into event_groups (event_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, g, F.A]);
  return id;
}

async function visibleTo(c: PoolClient, become: (u: string | null) => Promise<void>, id: string, who: Who[]) {
  const out: Partial<Record<Who, boolean>> = {};
  for (const w of who) {
    await become(F.users[w]);
    out[w] = (await c.query("select 1 from events where id = $1", [id])).rowCount === 1;
  }
  return out;
}

const EVERYONE: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent", "ownerB", "parentB"];

describe("events · audience", () => {
  it("garden / group / staff audiences", async () => {
    await inTx(async (c, become) => {
      const all = await createEvent(c, become, "head", "all");
      expect(await visibleTo(c, become, all, EVERYONE)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: true, parent: true, teacherParent: true, ownerB: false, parentB: false,
      });
      const stars = await createEvent(c, become, "head", "groups", [F.gA2]);
      expect(await visibleTo(c, become, stars, EVERYONE)).toEqual({
        owner: true, head: true, accountant: true, teacher: false, clubTeacher: false, cook: false, parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
      const staff = await createEvent(c, become, "owner", "staff");
      expect(await visibleTo(c, become, staff, EVERYONE)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: true, parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
      await become(F.users.parent);
      expect((await c.query("select 1 from event_groups where event_id = $1", [stars])).rowCount).toBe(0);
    });
  });

  it("teacher creates events only for own groups; parents and cooks cannot create", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect(await rejects(c, "insert into events (kindergarten_id, author_id, audience, title, date) values ($1, $2, 'all', 'x', '2030-01-01')", [F.A, F.users.teacher])).toBe(true);
      const id = (await c.query("insert into events (kindergarten_id, author_id, audience, title, date) values ($1, $2, 'groups', 'x', '2030-01-01') returning id", [F.A, F.users.teacher])).rows[0].id;
      await c.query("insert into event_groups (event_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, F.gA1, F.A]);
      expect(await rejects(c, "insert into event_groups (event_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, F.gA2, F.A])).toBe(true);
      expect(await rejects(c, "update events set audience = 'staff' where id = $1", [id])).toBe(true);
      expect(await rejects(c, "update events set reminded_for = date where id = $1", [id])).toBe(true);
      for (const w of ["parent", "cook", "clubTeacher", "accountant"] as Who[]) {
        await become(F.users[w]);
        expect(await rejects(c, "insert into events (kindergarten_id, author_id, audience, title, date) values ($1, $2, 'groups', 'x', '2030-01-01')", [F.A, F.users[w]]), w).toBe(true);
        expect((await c.query("update events set title = 'взлом' where id = $1", [id])).rowCount).toBe(0);
        expect((await c.query("delete from events where id = $1", [id])).rowCount).toBe(0);
      }
      await become(F.users.ownerB);
      expect(await rejects(c, "insert into events (kindergarten_id, author_id, audience, title, date) values ($1, $2, 'all', 'x', '2030-01-01')", [F.A, F.users.ownerB])).toBe(true);
      await become(F.users.head);
      expect((await c.query("update events set place = 'Зал' where id = $1", [id])).rowCount).toBe(1);
      expect((await c.query("delete from events where id = $1", [id])).rowCount).toBe(1);
    });
  });

  it("reminder helpers are server-only and claiming is idempotent", async () => {
    await inTx(async (c, become) => {
      const id = await createEvent(c, become, "head", "groups", [F.gA1], "2030-03-10");
      await become(F.users.head);
      expect(await rejects(c, "select * from claim_event_reminders($1, '2030-03-10')", [F.A])).toBe(true);
      expect(await rejects(c, "select * from event_recipients($1)", [id])).toBe(true);
      await c.query("reset role");
      const first = await c.query("select id from claim_event_reminders($1, '2030-03-10')", [F.A]);
      expect(first.rows.map((r) => r.id)).toEqual([id]);
      expect((await c.query("select id from claim_event_reminders($1, '2030-03-10')", [F.A])).rowCount).toBe(0);
      const rec = (await c.query("select * from event_recipients($1) as u", [id])).rows.map((r) => r.u).sort();
      expect(rec).toEqual([F.users.owner, F.users.head, F.users.accountant, F.users.teacher, F.users.parent, F.users.teacherParent].sort());
      // moving the event to another date re-arms the reminder
      await c.query("update events set date = '2030-03-11' where id = $1", [id]);
      expect((await c.query("select id from claim_event_reminders($1, '2030-03-11')", [F.A])).rowCount).toBe(1);
    });
  });
});

describe("calendar_birthdays", () => {
  const names = async (c: PoolClient, from = "2027-01-01", to = "2027-12-31") =>
    (await c.query("select kind, full_name from calendar_birthdays($1, $2, $3)", [F.A, from, to])).rows.map((r) => `${r.kind}:${r.full_name.split(" ")[1]}`).sort();

  async function setup(c: PoolClient) {
    await c.query("update children set birth_date = '2021-05-14' where id = $1", [F.children["Алихан"]]);
    await c.query("update children set birth_date = '2021-11-02' where id = $1", [F.children["Миша"]]);
    await c.query("update children set birth_date = '2022-02-20' where id = $1", [F.children["Айлин"]]);
    await c.query("update children set birth_date = '2022-07-09' where id = $1", [F.children["Сабина"]]);
    await c.query("update profiles set birth_date = null where id = any($1)", [Object.values(F.users)]);
    await c.query("update profiles set birth_date = '1990-04-01' where id = any($1)", [[F.users.teacher, F.users.cook, F.users.parent]]);
  }

  it("role filtering: admins all, teacher own groups + staff, parent own children, cook staff only", async () => {
    await inTx(async (c, become) => {
      await setup(c);
      const staff = ["staff:Асель", "staff:Гульнар"];
      await become(F.users.head);
      expect(await names(c)).toEqual(["child:Айлин", "child:Алихан", "child:Миша", "child:Сабина", ...staff].sort());
      await become(F.users.accountant);
      expect(await names(c)).toEqual(["child:Айлин", "child:Алихан", "child:Миша", "child:Сабина", ...staff].sort());
      await become(F.users.teacher);
      expect(await names(c)).toEqual(["child:Айлин", "child:Алихан", "child:Миша", ...staff].sort());
      await become(F.users.parent);
      expect(await names(c)).toEqual(["child:Алихан"]);
      await become(F.users.teacherParent);
      expect(await names(c)).toEqual(["child:Миша", "child:Сабина", ...staff].sort());
      await become(F.users.cook);
      expect(await names(c)).toEqual(staff);
      await become(F.users.clubTeacher);
      expect(await names(c)).toEqual(staff);
      await become(F.users.ownerB);
      expect(await names(c)).toEqual([]);
    });
    await asUser(null, async (c) => {
      expect(await rejects(c, "select * from calendar_birthdays($1, '2027-01-01', '2027-12-31')", [F.A])).toBe(true);
    });
  });

  it("year boundary, ages and 29 February", async () => {
    await inTx(async (c, become) => {
      await setup(c);
      await c.query("update children set birth_date = '2021-01-05' where id = $1", [F.children["Алихан"]]);
      await c.query("update children set birth_date = '2020-02-29' where id = $1", [F.children["Айлин"]]);
      await become(F.users.head);
      const r = (await c.query("select full_name, day::text, age from calendar_birthdays($1, '2026-12-20', '2027-03-10') where kind = 'child'", [F.A])).rows;
      expect(r.map((x) => [x.full_name.split(" ")[1], x.day, x.age])).toEqual([
        ["Алихан", "2027-01-05", 6],
        ["Айлин", "2027-02-28", 7],
      ]);
      expect((await c.query("select 1 from calendar_birthdays($1, '2026-01-01', '2028-12-31')", [F.A])).rowCount).toBe(0); // > 400 days
    });
  });
});

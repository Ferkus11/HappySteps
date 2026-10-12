import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx, tenantTables, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const count = async (c: import("pg").PoolClient, sql: string, params: unknown[] = []) =>
  Number((await c.query(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);

describe("tenant isolation (SPEC §11, scenario 10)", () => {
  const aUsers: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent"];
  it("no user of kindergarten A sees any row of kindergarten B in any table", async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThan(5);
    for (const who of aUsers) {
      await asUser(F.users[who], async (c) => {
        for (const t of tables) {
          expect(await count(c, `select 1 from public.${t} where kindergarten_id = $1`, [F.B]), `${who} → ${t}`).toBe(0);
        }
        expect(await count(c, "select 1 from kindergartens where id = $1", [F.B])).toBe(0);
      });
    }
  });
  it("no user of kindergarten B sees any row of kindergarten A", async () => {
    const tables = await tenantTables();
    for (const who of ["ownerB", "parentB"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        for (const t of tables) {
          expect(await count(c, `select 1 from public.${t} where kindergarten_id = $1`, [F.A]), `${who} → ${t}`).toBe(0);
        }
      });
    }
  });
  it("anonymous sees nothing", async () => {
    const tables = await tenantTables();
    await asUser(null, async (c) => {
      for (const t of [...tables, "profiles", "platform_admins"]) {
        expect(await count(c, `select 1 from public.${t}`), t).toBe(0);
      }
    });
  });
  it("cannot write into another kindergarten", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await rejects(c, "insert into groups (kindergarten_id, name) values ($1, 'x')", [F.B])).toBe(true);
      expect(await rejects(c, "insert into children (kindergarten_id, full_name, birth_date) values ($1, 'Чужой Ребёнок', '2021-01-01')", [F.B])).toBe(true);
      expect(await rejects(c, "insert into memberships (user_id, kindergarten_id, role) values ($1, $2, 'teacher')", [F.users.head, F.B])).toBe(true);
      const upd = await c.query("update children set full_name = 'Взлом' where kindergarten_id = $1", [F.B]);
      expect(upd.rowCount).toBe(0);
    });
  });
});

describe("children visibility", () => {
  it("parent sees only own child", async () => {
    await asUser(F.users.parent, async (c) => {
      const r = await c.query("select id from children");
      expect(r.rows.map((x) => x.id)).toEqual([F.children["Алихан"]]);
      expect(await count(c, "select 1 from child_guardians")).toBe(1);
    });
  });
  it("teacher sees only children of own group", async () => {
    await asUser(F.users.teacher, async (c) => {
      const r = await c.query("select group_id from children");
      expect(r.rows.length).toBe(3);
      expect(new Set(r.rows.map((x) => x.group_id))).toEqual(new Set([F.gA1]));
    });
  });
  it("teacher who is also a parent sees own group + own child", async () => {
    await asUser(F.users.teacherParent, async (c) => {
      const ids = (await c.query("select id from children")).rows.map((x) => x.id).sort();
      expect(ids).toEqual([F.children["Миша"], F.children["Сабина"]].sort());
    });
  });
  it("cook cannot read children but sees allergies via kitchen_allergies()", async () => {
    await asUser(F.users.cook, async (c) => {
      expect(await count(c, "select 1 from children")).toBe(0);
      const r = await c.query("select full_name, allergies from kitchen_allergies($1)", [F.A]);
      expect(r.rows.map((x) => x.allergies).sort()).toEqual(["молоко", "орехи"]);
    });
    await asUser(F.users.parent, async (c) => {
      expect(await count(c, "select 1 from kitchen_allergies($1)", [F.A])).toBe(0);
    });
  });
  it("accountant reads all children but cannot create or edit them", async () => {
    await asUser(F.users.accountant, async (c) => {
      expect(await count(c, "select 1 from children")).toBe(4);
      expect(await rejects(c, "insert into children (kindergarten_id, full_name, birth_date) values ($1, 'Новый Ребёнок', '2021-01-01')", [F.A])).toBe(true);
      expect((await c.query("update children set monthly_fee = 1 where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
    });
  });
  it("teacher cannot edit children", async () => {
    await asUser(F.users.teacher, async (c) => {
      expect((await c.query("update children set monthly_fee = 1")).rowCount).toBe(0);
      expect(await rejects(c, "insert into child_guardians (child_id, user_id, kindergarten_id) values ($1, $2, $3)", [F.children["Айлин"], F.users.teacher, F.A])).toBe(true);
    });
  });
});

describe("role management (SPEC §3.3)", () => {
  it("head may add teachers/parents but not owners, heads or accountants", async () => {
    await asUser(F.users.head, async (c) => {
      expect(await rejects(c, "insert into memberships (user_id, kindergarten_id, role) values ($1, $2, 'teacher')", [F.users.cook, F.A])).toBe(false);
      for (const role of ["owner", "head", "accountant"]) {
        expect(await rejects(c, `insert into memberships (user_id, kindergarten_id, role) values ($1, $2, '${role}')`, [F.users.cook, F.A]), role).toBe(true);
      }
      expect((await c.query("update memberships set status = 'archived' where user_id = $1 and role = 'accountant'", [F.users.accountant])).rowCount).toBe(0);
      expect((await c.query("update memberships set status = 'archived' where user_id = $1 and role = 'teacher'", [F.users.teacher])).rowCount).toBe(1);
    });
  });
  it("owner may add any role", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await rejects(c, "insert into memberships (user_id, kindergarten_id, role) values ($1, $2, 'accountant')", [F.users.cook, F.A])).toBe(false);
    });
  });
  it("teacher cannot add anyone, and nobody can promote themselves", async () => {
    await asUser(F.users.teacher, async (c) => {
      expect(await rejects(c, "insert into memberships (user_id, kindergarten_id, role) values ($1, $2, 'parent')", [F.users.cook, F.A])).toBe(true);
      expect(await rejects(c, "update memberships set role = 'owner' where user_id = $1", [F.users.teacher])).toBe(true);
    });
  });
  it("the last owner cannot be archived", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await rejects(c, "update memberships set status = 'archived' where user_id = $1 and role = 'owner'", [F.users.owner])).toBe(true);
    });
  });
  it("users cannot change their own name or phone", async () => {
    await asUser(F.users.parent, async (c) => {
      expect(await rejects(c, "update profiles set phone = '+77779999999' where id = $1", [F.users.parent])).toBe(true);
      expect(await rejects(c, "update profiles set full_name = 'Другой' where id = $1", [F.users.parent])).toBe(true);
      expect((await c.query("update profiles set locale = 'kk' where id = $1", [F.users.parent])).rowCount).toBe(1);
    });
  });
});

describe("archive & block", () => {
  it("archived teacher loses access immediately", async () => {
    await inTx(async (c, become) => {
      await c.query("update memberships set status = 'archived' where user_id = $1 and role = 'teacher'", [F.users.teacher]);
      await become(F.users.teacher);
      expect(await count(c, "select 1 from children")).toBe(0);
      expect(await count(c, "select 1 from groups")).toBe(0);
    });
  });
  it("members of a blocked kindergarten see nothing", async () => {
    await inTx(async (c, become) => {
      await c.query("update kindergartens set status = 'blocked' where id = $1", [F.A]);
      await become(F.users.owner);
      expect(await count(c, "select 1 from children")).toBe(0);
      expect(await count(c, "select 1 from groups")).toBe(0);
    });
  });
  it("archiving the only child archives the parent membership", async () => {
    await inTx(async (c, become) => {
      await become(F.users.head);
      await c.query("update children set status = 'archived' where id = $1", [F.children["Алихан"]]);
      await c.query("reset role");
      const r = await c.query("select status from memberships where user_id = $1 and kindergarten_id = $2 and role = 'parent'", [F.users.parent, F.A]);
      expect(r.rows[0].status).toBe("archived");
    });
  });
});

describe("profiles, audit, private tables", () => {
  it("parent sees staff profiles but not other parents", async () => {
    await asUser(F.users.parent, async (c) => {
      expect(await count(c, "select 1 from profiles where id = $1", [F.users.teacher])).toBe(1);
      expect(await count(c, "select 1 from profiles where id = $1", [F.users.parentB])).toBe(0);
      // teacherParent is staff, so visible; a pure parent of another child is not.
      await c.query("reset role");
    });
  });
  it("audit log is readable by owner/head only and cannot be written directly", async () => {
    await asUser(F.users.head, async (c) => {
      await c.query("select log_action($1, 'test.action', 'test', null, '{}')", [F.A]);
      expect(await count(c, "select 1 from audit_log where action = 'test.action'")).toBe(1);
      expect(await rejects(c, "insert into audit_log (kindergarten_id, action) values ($1, 'forged')", [F.A])).toBe(true);
      expect((await c.query("delete from audit_log")).rowCount).toBe(0);
    });
    await asUser(F.users.teacher, async (c) => {
      expect(await count(c, "select 1 from audit_log")).toBe(0);
    });
  });
  it("invites and login attempts are invisible to users", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await count(c, "select 1 from invites")).toBe(0);
      expect(await count(c, "select 1 from login_attempts")).toBe(0);
      expect(await rejects(c, "select login_attempts_check('+77010000001', 'x', 15, 5)")).toBe(true);
    });
  });
  it("head cannot change owner-only settings", async () => {
    await asUser(F.users.head, async (c) => {
      expect(await rejects(c, `update kindergarten_settings set requisites = '{"iban":"hack"}' where kindergarten_id = $1`, [F.A])).toBe(true);
      expect((await c.query("update kindergarten_settings set late_threshold_minutes = 15 where kindergarten_id = $1", [F.A])).rowCount).toBe(1);
      expect((await c.query("update kindergartens set name = 'Hack' where id = $1", [F.A])).rowCount).toBe(0);
    });
  });
  it("only superadmin sees the platform overview", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await count(c, "select 1 from admin_kindergartens()")).toBe(0);
    });
    await asUser(F.users.superadmin, async (c) => {
      expect(await count(c, "select 1 from admin_kindergartens()")).toBeGreaterThanOrEqual(2);
      expect(await count(c, "select 1 from children")).toBe(0); // superadmin is outside kindergartens
    });
  });
});

describe("domain functions", () => {
  it("transfer_child keeps history bound to the date", async () => {
    await asUser(F.users.head, async (c) => {
      await c.query("select transfer_child($1, $2, '2026-10-01')", [F.children["Айлин"], F.gA2]);
      const before = await c.query("select child_group_on($1, '2026-09-15') as g", [F.children["Айлин"]]);
      const after = await c.query("select child_group_on($1, '2026-10-05') as g", [F.children["Айлин"]]);
      expect(before.rows[0].g).toBe(F.gA1);
      expect(after.rows[0].g).toBe(F.gA2);
    });
    await asUser(F.users.teacher, async (c) => {
      expect(await rejects(c, "select transfer_child($1, $2, '2026-10-01')", [F.children["Айлин"], F.gA2])).toBe(true);
    });
  });
  it("a group with active children cannot be deleted", async () => {
    await asUser(F.users.head, async (c) => {
      expect(await rejects(c, "delete from groups where id = $1", [F.gA1])).toBe(true);
    });
  });
});

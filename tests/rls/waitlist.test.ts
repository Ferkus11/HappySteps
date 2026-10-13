import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, asUser, inTx, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const ALL: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent", "ownerB", "parentB"];

/** An application as the public form stores it (superuser = like the service role). */
async function application(c: PoolClient, kg: string, status: "new" | "contacted" | "declined" = "new") {
  const id = randomUUID();
  await c.query(
    `insert into waitlist_applications (id, kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, source, created_by)
     values ($1, $2, 'Тестов Тимур', '2022-03-01', 'Тестова Анна', '+77059990001', 'public', null)`,
    [id, kg],
  );
  if (status !== "new") await c.query("update waitlist_applications set status = $2 where id = $1", [id, status]);
  return id;
}

async function visibility(c: PoolClient, become: (u: string | null) => Promise<void>, table: string, id: string) {
  const out: Partial<Record<Who, boolean>> = {};
  for (const w of ALL) {
    await become(F.users[w]);
    out[w] = (await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount === 1;
  }
  await become(null);
  expect((await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount, "anon").toBe(0);
  await c.query("reset role");
  return out;
}

const STAFF_A = { owner: true, head: true, accountant: true, teacher: false, clubTeacher: false, cook: false, parent: false, teacherParent: false, ownerB: false, parentB: false };

describe("waitlist · visibility (§3.4: owner/head ✅, accountant 👁, others —)", () => {
  it("applications of garden A: owner, head and accountant only", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      expect(await visibility(c, become, "waitlist_applications", id)).toEqual(STAFF_A);
    });
  });

  it("comments and status history follow the application", async () => {
    await inTx(async (c, become) => {
      const app = await application(c, F.A, "contacted");
      const { rows } = await c.query("select id from waitlist_comments where application_id = $1 and kind = 'status'", [app]);
      expect(rows.length).toBe(1);
      expect(await visibility(c, become, "waitlist_comments", rows[0].id)).toEqual(STAFF_A);
    });
  });

  it("garden B application is visible to its owner only", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.B);
      const v = await visibility(c, become, "waitlist_applications", id);
      expect(Object.entries(v).filter(([, x]) => x).map(([k]) => k)).toEqual(["ownerB"]);
    });
  });

  it("the rate-limit log is invisible and unwritable for everybody", async () => {
    for (const who of ["owner", "head", "accountant"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        expect((await c.query("select 1 from waitlist_rate_limits")).rowCount).toBe(0);
        expect(await rejects(c, "insert into waitlist_rate_limits (kindergarten_id, ip_hash, phone_hash) values ($1, 'x', 'y')", [F.A])).toBe(true);
        expect(await rejects(c, "delete from waitlist_rate_limits")).toBe(true);
      });
    }
    await asUser(null, async (c) => {
      expect((await c.query("select 1 from waitlist_rate_limits")).rowCount).toBe(0);
      expect((await c.query("select 1 from waitlist_applications")).rowCount).toBe(0);
      expect(await rejects(c, "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone) values ($1, 'Аноним Тест', '2022-01-01', 'Аноним Тест', '+77059990009')", [F.A])).toBe(true);
    });
  });
});

describe("waitlist · writes", () => {
  const manual = "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone) values ($1, 'Ручная Заявка', '2022-01-01', 'Родитель Тест', '+77059990002') returning source, status, created_by";

  it("owner/head add an application by hand: source «manual», author = self, status «Новая»", async () => {
    for (const who of ["owner", "head"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        const r = (await c.query(manual, [F.A])).rows[0];
        expect(r).toEqual({ source: "manual", status: "new", created_by: F.users[who] });
      });
    }
  });

  it("nobody else can add, and service columns cannot be forged", async () => {
    for (const who of ["accountant", "teacher", "cook", "parent", "ownerB"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        expect(await rejects(c, manual, [F.A]), who).toBe(true);
      });
    }
    await asUser(F.users.head, async (c) => {
      expect(await rejects(c, manual, [F.B])).toBe(true);
      expect(
        await rejects(
          c,
          "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, source) values ($1, 'Ручная Заявка', '2022-01-01', 'Родитель Тест', '+77059990002', 'public')",
          [F.A],
        ),
      ).toBe(true);
      expect(
        await rejects(
          c,
          "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, child_id) values ($1, 'Ручная Заявка', '2022-01-01', 'Родитель Тест', '+77059990002', $2)",
          [F.A, F.children["Айлин"]],
        ),
      ).toBe(true);
      expect(await rejects(c, "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone) values ($1, 'Ручная Заявка', '2022-01-01', 'Родитель Тест', '87011234567')", [F.A])).toBe(true);
    });
  });

  it("status: head sets «Связались»/«Отказались» (logged); «Принята» only through accept; accountant cannot change", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      await become(F.users.accountant);
      expect((await c.query("update waitlist_applications set status = 'contacted' where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.teacher);
      expect((await c.query("update waitlist_applications set status = 'contacted' where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.head);
      expect((await c.query("update waitlist_applications set status = 'contacted' where id = $1", [id])).rowCount).toBe(1);
      expect(await rejects(c, "update waitlist_applications set status = 'accepted' where id = $1", [id])).toBe(true);
      expect(await rejects(c, "update waitlist_applications set child_id = $2 where id = $1", [id, F.children["Айлин"]])).toBe(true);
      expect(await rejects(c, "update waitlist_applications set source = 'manual' where id = $1", [id])).toBe(true);
      const log = await c.query("select status, author_id from waitlist_comments where application_id = $1 and kind = 'status'", [id]);
      expect(log.rows).toEqual([{ status: "contacted", author_id: F.users.head }]);
    });
  });

  it("comments: owner/head write as themselves; accountant and other gardens cannot; status entries cannot be forged", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      const idB = await application(c, F.B);
      const add = "insert into waitlist_comments (kindergarten_id, application_id, body) values ($1, $2, 'Перезвонить завтра') returning author_id, kind";
      await become(F.users.head);
      expect((await c.query(add, [F.A, id])).rows[0]).toEqual({ author_id: F.users.head, kind: "comment" });
      expect(await rejects(c, add, [F.B, idB])).toBe(true);
      expect(await rejects(c, add, [F.A, idB])).toBe(true);
      expect(await rejects(c, "insert into waitlist_comments (kindergarten_id, application_id, kind, status) values ($1, $2, 'status', 'accepted')", [F.A, id])).toBe(true);
      expect(await rejects(c, "insert into waitlist_comments (kindergarten_id, application_id, body, author_id) values ($1, $2, 'x', $3)", [F.A, id, F.users.owner])).toBe(true);
      await become(F.users.accountant);
      expect(await rejects(c, add, [F.A, id])).toBe(true);
    });
  });

  it("delete: head removes spam; accepted applications stay", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      const { rows } = await c.query("select id from waitlist_applications where kindergarten_id = $1 and status = 'accepted'", [F.A]);
      await become(F.users.accountant);
      expect((await c.query("delete from waitlist_applications where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.head);
      expect((await c.query("delete from waitlist_applications where id = $1", [rows[0].id])).rowCount).toBe(0);
      expect((await c.query("delete from waitlist_applications where id = $1", [id])).rowCount).toBe(1);
    });
  });
});

/** The error message of a statement (null = it succeeded), inside a savepoint so the transaction goes on. */
async function errorOf(c: PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query("savepoint e");
  try {
    await c.query(sql, params);
    await c.query("release savepoint e");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint e");
    return (e as Error).message;
  }
}

const ACCEPT = "select waitlist_accept($1, $2, $3, '2022-03-01', $4, '2026-09-01', 50000, $5, false) r";

describe("waitlist · «Принять» (one transaction, claim token)", () => {
  it("begin → accept: membership, child, guardian, «Принята» and audit in one go, with the caller's checks", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A, "contacted");
      const groupB = (await c.query("select id from groups where kindergarten_id = $1 limit 1", [F.B])).rows[0].id;
      const parent = F.users.parentB; // a person not yet in garden A
      const name = "Принятов Тимур";
      await become(F.users.accountant);
      expect(await rejects(c, "select waitlist_begin_accept($1)", [id])).toBe(true);
      await become(F.users.ownerB);
      expect(await rejects(c, "select waitlist_begin_accept($1)", [id])).toBe(true);

      await become(F.users.head);
      const claim = (await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r;
      expect(claim).toEqual({ state: "ok", token: expect.any(String) });
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toEqual({ state: "busy" });

      // without the claim token, with a group of another garden, or failing half-way: nothing is left behind
      expect(await errorOf(c, ACCEPT, [id, randomUUID(), name, F.gA1, parent])).toMatch(/hs:waitlistBusy/);
      expect(await errorOf(c, ACCEPT, [id, null, name, F.gA1, parent])).toMatch(/hs:waitlistBusy/);
      expect(await errorOf(c, ACCEPT, [id, claim.token, name, groupB, parent])).toMatch(/kindergarten mismatch/);
      expect(await errorOf(c, ACCEPT, [id, claim.token, "Я", F.gA1, parent])).not.toBeNull(); // child check fails after the membership insert
      await become(F.users.teacher);
      expect(await errorOf(c, ACCEPT, [id, claim.token, name, F.gA1, parent])).toMatch(/hs:notFound/);
      await c.query("reset role");
      expect((await c.query("select 1 from memberships where user_id = $1 and kindergarten_id = $2", [parent, F.A])).rowCount).toBe(0);
      expect((await c.query("select 1 from children where full_name = $1", [name])).rowCount).toBe(0);
      expect((await c.query("select 1 from audit_log where action in ('account.create', 'child.create') and details->>'name' = $1", [name])).rowCount).toBe(0);

      await become(F.users.head);
      const child = (await c.query(ACCEPT, [id, claim.token, name, F.gA1, parent])).rows[0].r;
      await c.query("reset role");
      const kid = (await c.query("select kindergarten_id, group_id, monthly_fee::int as fee from children where id = $1", [child])).rows[0];
      expect(kid).toEqual({ kindergarten_id: F.A, group_id: F.gA1, fee: 50000 });
      expect((await c.query("select 1 from child_guardians where child_id = $1 and user_id = $2", [child, parent])).rowCount).toBe(1);
      const m = (await c.query("select status, created_by from memberships where user_id = $1 and kindergarten_id = $2 and role = 'parent'", [parent, F.A])).rows;
      expect(m).toEqual([{ status: "active", created_by: F.users.head }]);
      const row = (await c.query("select status, child_id, parent_user_id, accepted_by, accepting_since, accepting_token from waitlist_applications where id = $1", [id])).rows[0];
      expect(row).toEqual({ status: "accepted", child_id: child, parent_user_id: parent, accepted_by: F.users.head, accepting_since: null, accepting_token: null });
      const audit = await c.query(
        "select action from audit_log where actor_id = $1 and (entity_id = $2 or entity_id = $3 or (action = 'account.create' and entity_id = $4)) order by action",
        [F.users.head, id, child, parent],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(["account.create", "child.create", "guardian.link", "waitlist.accept"]);

      await become(F.users.head);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toEqual({ state: "accepted", child_id: child });
      expect(await errorOf(c, ACCEPT, [id, claim.token, name, F.gA1, parent])).toMatch(/hs:waitlistAccepted/);
      expect(await rejects(c, "update waitlist_applications set status = 'declined' where id = $1", [id])).toBe(true);
      expect(await rejects(c, "update waitlist_applications set accepting_token = null where id = $1", [id])).toBe(true);
    });
  });

  it("an existing parent membership is reused, an archived one re-activated", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      await c.query("update memberships set status = 'archived', archived_at = now() where user_id = $1 and kindergarten_id = $2 and role = 'parent'", [F.users.parent, F.A]);
      await become(F.users.owner);
      const { token } = (await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r;
      await c.query(ACCEPT, [id, token, "Второй Ребёнок", F.gA1, F.users.parent]);
      await c.query("reset role");
      const m = await c.query("select status from memberships where user_id = $1 and kindergarten_id = $2 and role = 'parent'", [F.users.parent, F.A]);
      expect(m.rows).toEqual([{ status: "active" }]);
    });
  });

  it("an expired claim taken over: the old attempt can neither finish nor release the new claim", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      await become(F.users.head);
      const first = (await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r.token;
      await c.query("reset role");
      await c.query("update waitlist_applications set accepting_since = now() - interval '3 minutes' where id = $1", [id]);
      await become(F.users.owner);
      const second = (await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r.token;
      expect(second).not.toBe(first);
      await become(F.users.head);
      await c.query("select waitlist_abort_accept($1, $2)", [id, first]);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toEqual({ state: "busy" });
      expect(await errorOf(c, ACCEPT, [id, first, "Старый Клик", F.gA1, null])).toMatch(/hs:waitlistBusy/);
      await become(F.users.owner);
      await c.query("select waitlist_abort_accept($1, $2)", [id, second]);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r.state).toBe("ok");
    });
  });
});

describe("waitlist · date bounds (DB)", () => {
  it("birth date not in the future, desired date within 3 years", async () => {
    await asUser(F.users.head, async (c) => {
      const ins = "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, desired_date) values ($1, 'Даты Тест', $2, 'Родитель Тест', '+77059990002', $3)";
      expect(await errorOf(c, ins, [F.A, "2099-01-01", null])).toMatch(/hs:dateInvalid/);
      expect(await errorOf(c, ins, [F.A, "2022-01-01", "2099-01-01"])).toMatch(/hs:dateInvalid/);
      expect(await errorOf(c, ins, [F.A, "2022-01-01", "1999-01-01"])).not.toBeNull();
      expect(await errorOf(c, ins, [F.A, "2022-01-01", null])).toBeNull();
    });
  });
});

describe("waitlist · public form (service role only)", () => {
  type Opt = { phone?: string; ip?: string | null; child?: string; ipMax?: number; kgMax?: number; phoneMax?: number; kg?: string };
  const submit = (o: Opt = {}) => {
    const phone = o.phone ?? "+77059990003";
    return [
      `select waitlist_public_submit($1, $2, '2022-05-05', 'Публичный Родитель', $3, null, null, $4, $5, $6, $7, $8) r`,
      [o.kg ?? F.A, o.child ?? "Публичный Ребёнок", phone, o.ip === undefined ? "ip-1" : o.ip, `ph-${phone}`, o.ipMax ?? 10, o.kgMax ?? 60, o.phoneMax ?? 3],
    ] as const;
  };
  const run = async (c: PoolClient, o: Opt = {}) => {
    const [sql, params] = submit(o);
    return errorOf(c, sql, [...params]);
  };

  it("anonymous and signed-in users cannot call it", async () => {
    for (const who of [null, F.users.owner, F.users.parent]) {
      await asUser(who, async (c) => {
        const [sql, params] = submit();
        expect(await rejects(c, sql, [...params])).toBe(true);
      });
    }
  });

  it("defaults: 10 per IP per garden per hour, 60 per garden per hour, 3 per phone per day", async () => {
    const { rows } = await admin((c) => c.query("select pg_get_function_arguments('public.waitlist_public_submit'::regproc) a"));
    expect(rows[0].a).toMatch(/p_ip_max integer DEFAULT 10, p_kg_max integer DEFAULT 60, p_phone_max integer DEFAULT 3/);
  });

  it("inserts a public application, does not duplicate it, and limits by phone", async () => {
    await inTx(async (c) => {
      await c.query("delete from waitlist_rate_limits");
      const [sql, params] = submit();
      const first = (await c.query(sql, [...params])).rows[0].r;
      expect(first.created).toBe(true);
      const row = (await c.query("select source, status, created_by from waitlist_applications where id = $1", [first.id])).rows[0];
      expect(row).toEqual({ source: "public", status: "new", created_by: null });
      const again = (await c.query(sql, [...params])).rows[0].r;
      expect(again).toEqual({ id: first.id, created: false });
      // third submission of this phone in 24h is still allowed, the fourth is not — from any IP
      expect(await run(c)).toBeNull();
      expect(await run(c, { ip: "ip-other" })).toMatch(/hs:tooManyApplications/);
      expect(await run(c, { ip: null })).toMatch(/hs:tooManyApplications/);
    });
  });

  it("the IP limit is per garden; an unknown IP skips it but the garden cap still applies", async () => {
    await inTx(async (c) => {
      await c.query("delete from waitlist_rate_limits");
      const phone = (n: number) => `+770599901${String(n).padStart(2, "0")}`;
      // one IP: 3 (test maximum) to garden A, then refused there — but garden B still accepts it
      for (const n of [1, 2, 3]) expect(await run(c, { phone: phone(n), ipMax: 3 })).toBeNull();
      expect(await run(c, { phone: phone(4), ipMax: 3 })).toMatch(/hs:tooManyApplications/);
      expect(await run(c, { phone: phone(4), ipMax: 3, kg: F.B })).toBeNull();
      // other IPs and unknown IPs are not in that bucket
      expect(await run(c, { phone: phone(5), ipMax: 3, ip: "ip-2" })).toBeNull();
      expect(await run(c, { phone: phone(6), ipMax: 3, ip: null })).toBeNull();
      expect(await run(c, { phone: phone(7), ipMax: 3, ip: null })).toBeNull();
      // garden A has 6 submissions this hour: a garden cap of 6 stops everybody, unknown IPs included
      expect(await run(c, { phone: phone(8), ip: "ip-9", kgMax: 6 })).toMatch(/hs:tooManyApplications/);
      expect(await run(c, { phone: phone(8), ip: null, kgMax: 6 })).toMatch(/hs:tooManyApplications/);
      expect(await run(c, { phone: phone(8), ip: "ip-9", kgMax: 7 })).toBeNull();
      const nulls = await c.query("select count(*)::int as n from waitlist_rate_limits where kindergarten_id = $1 and ip_hash is null", [F.A]);
      expect(nulls.rows[0].n).toBe(2);
    });
  });

  it("a blocked garden does not accept applications", async () => {
    await inTx(async (c) => {
      await c.query("update kindergartens set status = 'blocked' where id = $1", [F.A]);
      expect(await run(c, { phone: "+77059990005", ip: "ip-3" })).toMatch(/hs:notFound/);
    });
  });
});

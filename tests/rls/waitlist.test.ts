import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
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

describe("waitlist · «Принять»", () => {
  it("claim → link the child → «Принята» (final, audited); double claim is «busy», then «accepted»", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A, "contacted");
      const childB = F.children["Саша"];
      await become(F.users.accountant);
      expect(await rejects(c, "select waitlist_begin_accept($1)", [id])).toBe(true);
      await become(F.users.ownerB);
      expect(await rejects(c, "select waitlist_begin_accept($1)", [id])).toBe(true);
      await become(F.users.head);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toBe("ok");
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toBe("busy");
      // the child must belong to the same garden, and the parent must be its guardian
      expect(await rejects(c, "select waitlist_finish_accept($1, $2, null)", [id, childB])).toBe(true);
      expect(await rejects(c, "select waitlist_finish_accept($1, $2, $3)", [id, F.children["Айлин"], F.users.parent])).toBe(true);
      await c.query("select waitlist_finish_accept($1, $2, $3)", [id, F.children["Алихан"], F.users.parent]);
      const row = (await c.query("select status, child_id, parent_user_id, accepted_by, accepting_since from waitlist_applications where id = $1", [id])).rows[0];
      expect(row).toEqual({ status: "accepted", child_id: F.children["Алихан"], parent_user_id: F.users.parent, accepted_by: F.users.head, accepting_since: null });
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toBe("accepted");
      expect(await rejects(c, "select waitlist_finish_accept($1, $2, null)", [id, F.children["Айлин"]])).toBe(true);
      expect(await rejects(c, "update waitlist_applications set status = 'declined' where id = $1", [id])).toBe(true);
      const audit = await c.query("select actor_id from audit_log where action = 'waitlist.accept' and entity_id = $1", [id]);
      expect(audit.rows).toEqual([{ actor_id: F.users.head }]);
    });
  });

  it("abort releases the claim", async () => {
    await inTx(async (c, become) => {
      const id = await application(c, F.A);
      await become(F.users.owner);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toBe("ok");
      await c.query("select waitlist_abort_accept($1)", [id]);
      expect((await c.query("select waitlist_begin_accept($1) r", [id])).rows[0].r).toBe("ok");
    });
  });
});

describe("waitlist · public form (service role only)", () => {
  const submit = (phone = "+77059990003", ip = "ip-1", phoneHash = `ph-${phone}`, child = "Публичный Ребёнок") =>
    [`select waitlist_public_submit($1, $2, '2022-05-05', 'Публичный Родитель', $3, null, null, $4, $5) r`, [F.A, child, phone, ip, phoneHash]] as const;

  it("anonymous and signed-in users cannot call it", async () => {
    for (const who of [null, F.users.owner, F.users.parent]) {
      await asUser(who, async (c) => {
        const [sql, params] = submit();
        expect(await rejects(c, sql, [...params])).toBe(true);
      });
    }
  });

  it("inserts a public application, does not duplicate it, and rate-limits by phone and by IP", async () => {
    await inTx(async (c) => {
      await c.query("delete from waitlist_rate_limits");
      const [sql, params] = submit();
      const first = (await c.query(sql, [...params])).rows[0].r;
      expect(first.created).toBe(true);
      const row = (await c.query("select source, status, created_by from waitlist_applications where id = $1", [first.id])).rows[0];
      expect(row).toEqual({ source: "public", status: "new", created_by: null });
      const again = (await c.query(sql, [...params])).rows[0].r;
      expect(again).toEqual({ id: first.id, created: false });
      // third submission of this phone in 24h is still allowed, the fourth is not
      await c.query(sql, [...params]);
      expect(await rejects(c, sql, [...params])).toBe(true);
      // the same IP with other phones: 5 accepted submissions per hour in total (3 used above)
      for (const n of [1, 2]) {
        const [s, p] = submit(`+7705999001${n}`, "ip-1", `ph-other-${n}`, "Другой Ребёнок");
        expect((await c.query(s, [...p])).rows[0].r.created).toBe(true);
      }
      const [s2, p2] = submit("+77059990013", "ip-1", "ph-other-3", "Другой Ребёнок");
      expect(await rejects(c, s2, [...p2])).toBe(true);
      const [s3, p3] = submit("+77059990013", "ip-2", "ph-other-3", "Другой Ребёнок");
      expect((await c.query(s3, [...p3])).rows[0].r.created).toBe(true);
    });
  });

  it("a blocked garden does not accept applications", async () => {
    await inTx(async (c) => {
      await c.query("update kindergartens set status = 'blocked' where id = $1", [F.A]);
      const [sql, params] = submit("+77059990005", "ip-3");
      expect(await rejects(c, sql, [...params])).toBe(true);
    });
  });
});

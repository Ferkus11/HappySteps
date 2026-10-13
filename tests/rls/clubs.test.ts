import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, inTx, pool, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
const clubs: Record<string, string> = {};
beforeAll(async () => {
  F = await fx();
  await admin(async (c) => {
    const r = await c.query("select id, name from clubs where kindergarten_id = $1", [F.A]);
    for (const x of r.rows) clubs[x.name] = x.id;
  });
  for (const n of ["Шахматы", "Рисование", "Английский язык", "Танцы"]) if (!clubs[n]) throw new Error(`fixture club ${n} missing — reseed`);
});

const ALL: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent", "ownerB", "parentB"];

/** Runs a statement that must fail with the given message, keeping the transaction usable. */
async function failsWith(c: PoolClient, sql: string, params: unknown[], re: RegExp) {
  await c.query("savepoint e");
  try {
    await c.query(sql, params);
    throw new Error(`expected failure: ${sql}`);
  } catch (e) {
    expect(String((e as Error).message)).toMatch(re);
  } finally {
    await c.query("rollback to savepoint e");
  }
}

const one = async (c: PoolClient, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const call = async (c: PoolClient, fn: string, ...args: unknown[]) =>
  (await one(c, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).r as {
    id: string;
    status: string;
    position: number | null;
    freed: boolean;
    queued: number;
  };
const enrollmentOf = async (c: PoolClient, club: string, child: string) =>
  (await one(c, "select id, status from club_enrollments where club_id = $1 and child_id = $2 and status in ('requested','queued','active')", [clubs[club], F.children[child]])) as
    | { id: string; status: string }
    | undefined;

async function visibleTo(c: PoolClient, become: (u: string | null) => Promise<void>, sql: string, params: unknown[]) {
  const out: Partial<Record<Who, boolean>> = {};
  for (const w of ALL) {
    await become(F.users[w]);
    out[w] = ((await c.query(sql, params)).rowCount ?? 0) > 0;
  }
  await become(null);
  await c.query("savepoint anon");
  const anon = await c.query(sql, params).catch(() => ({ rowCount: 0 }));
  await c.query("rollback to savepoint anon");
  expect(anon.rowCount, "anon").toBe(0);
  await c.query("reset role");
  return out;
}

describe("clubs · visibility (SPEC §3.4 «Кружки»)", () => {
  it("catalog: every role of garden A except the cook; a club teacher only own clubs; nobody from garden B", async () => {
    await inTx(async (c, become) => {
      expect(await visibleTo(c, become, "select 1 from clubs where id = $1", [clubs["Шахматы"]])).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: false,
        parent: true, teacherParent: true, ownerB: false, parentB: false,
      });
      expect(await visibleTo(c, become, "select 1 from clubs where id = $1", [clubs["Английский язык"]])).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: false, cook: false,
        parent: true, teacherParent: true, ownerB: false, parentB: false,
      });
      await become(F.users.clubTeacher);
      expect((await c.query("select club_id from club_stats($1)", [F.A])).rows.map((r) => r.club_id).sort()).toEqual([clubs["Шахматы"], clubs["Рисование"]].sort());
    });
  });

  it("enrollments: admins + accountant, the club's teacher, the child's group teacher and guardians", async () => {
    await inTx(async (c, become) => {
      const misha = (await enrollmentOf(c, "Шахматы", "Миша"))!.id; // Солнышко, guardian teacherParent
      expect(await visibleTo(c, become, "select 1 from club_enrollments where id = $1", [misha])).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: false,
        parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
      const sabina = (await enrollmentOf(c, "Рисование", "Сабина"))!.id; // Звёздочки (teacherParent teaches it)
      expect(await visibleTo(c, become, "select 1 from club_enrollments where id = $1", [sabina])).toEqual({
        owner: true, head: true, accountant: true, teacher: false, clubTeacher: true, cook: false,
        parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
    });
  });

  it("a club teacher sees nothing of a club they do not teach", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into club_enrollments (kindergarten_id, club_id, child_id, status) values ($1, $2, $3, 'requested')", [F.A, clubs["Английский язык"], F.children["Алихан"]]);
      await become(F.users.clubTeacher);
      expect((await c.query("select 1 from club_enrollments where club_id = $1", [clubs["Английский язык"]])).rowCount).toBe(0);
      expect((await c.query("select * from club_roster($1)", [clubs["Английский язык"]])).rowCount).toBe(0);
      expect((await c.query("select * from club_roster($1)", [clubs["Шахматы"]])).rowCount).toBe(1);
    });
  });

  it("roster with parents' phones: admins, accountant and the club's teacher only", async () => {
    await inTx(async (c, become) => {
      const r = await visibleTo(c, become, "select * from club_roster($1)", [clubs["Шахматы"]]);
      expect(r).toEqual({
        owner: true, head: true, accountant: true, teacher: false, clubTeacher: true, cook: false,
        parent: false, teacherParent: false, ownerB: false, parentB: false,
      });
      await become(F.users.clubTeacher);
      const row = await one(c, "select * from club_roster($1)", [clubs["Шахматы"]]);
      expect(row.child_name).toMatch(/Миша/);
      expect(row.parents[0].phone).toBe("+77010000008");
    });
  });

  it("place counters for parents; nothing for the cook or another garden", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const s = await one(c, "select * from club_stats($1) where club_id = $2", [F.A, clubs["Шахматы"]]);
      expect(s).toMatchObject({ capacity: 1, active: 1, free: 0, queued: 0 });
      await become(F.users.cook);
      expect((await c.query("select * from club_stats($1)", [F.A])).rowCount).toBe(0);
      await become(F.users.parentB);
      expect((await c.query("select * from club_stats($1)", [F.A])).rowCount).toBe(0);
    });
  });
});

describe("clubs · writes", () => {
  it("nobody writes enrollments directly — not even the owner", async () => {
    await inTx(async (c, become) => {
      const misha = (await enrollmentOf(c, "Шахматы", "Миша"))!.id;
      for (const w of ["owner", "head", "parent", "teacherParent", "clubTeacher"] as Who[]) {
        await become(F.users[w]);
        expect(
          await rejects(c, "insert into club_enrollments (kindergarten_id, club_id, child_id, status) values ($1, $2, $3, 'active')", [F.A, clubs["Английский язык"], F.children["Алихан"]]),
          w,
        ).toBe(true);
        expect(await rejects(c, "update club_enrollments set status = 'left' where id = $1", [misha]), w).toBe(true);
        expect(await rejects(c, "delete from club_enrollments where id = $1", [misha]), w).toBe(true);
      }
    });
  });

  it("catalog writes: owner and head only; teacher must be an active club teacher; photo path stays in the garden", async () => {
    await inTx(async (c, become) => {
      const ins = "insert into clubs (kindergarten_id, name, age_from, age_to, capacity, teacher_id, photo_path) values ($1, 'Лепка', 3, 6, 5, $2, $3) returning id";
      for (const w of ["accountant", "teacher", "clubTeacher", "parent", "cook", "ownerB"] as Who[]) {
        await become(F.users[w]);
        expect(await rejects(c, ins, [F.A, null, null]), w).toBe(true);
        expect(await rejects(c, "update clubs set capacity = 3 where id = $1 returning id", [clubs["Шахматы"]]).then(async (r) => r || (await c.query("select 1 from clubs where id = $1 and capacity = 3", [clubs["Шахматы"]])).rowCount === 0), w).toBe(true);
      }
      await become(F.users.head);
      const id = (await one(c, ins, [F.A, F.users.clubTeacher, null])).id;
      expect((await one(c, "select created_by from clubs where id = $1", [id])).created_by).toBe(F.users.head);
      await failsWith(c, ins, [F.A, F.users.teacher, null], /hs:clubTeacherInvalid/);
      await failsWith(c, ins, [F.A, null, `${F.B}/clubs/x.png`], /check/);
      await failsWith(c, "update clubs set schedule = '[{\"day\": 8, \"start\": \"10:00\", \"end\": \"11:00\"}]' where id = $1", [id], /check/);
      await failsWith(c, "update clubs set schedule = '[{\"day\": 1, \"start\": \"11:00\", \"end\": \"10:00\"}]' where id = $1", [id], /check/);
      await c.query("update clubs set schedule = '[{\"day\": 1, \"start\": \"10:00\", \"end\": \"10:30\"}]' where id = $1", [id]);
      expect(await rejects(c, "update clubs set created_by = $2 where id = $1", [id, F.users.owner])).toBe(true);
      // a club cannot be shrunk below the children already attending it
      await failsWith(c, "update clubs set capacity = 0 where id = $1", [clubs["Шахматы"]], /hs:clubCapacityBelowActive/);
      await c.query("update clubs set capacity = 1 where id = $1", [clubs["Шахматы"]]);
      await become(F.users.owner);
      expect((await c.query("delete from clubs where id = $1 returning id", [id])).rowCount).toBe(1);
    });
  });
});

describe("clubs · enrolment flow (SPEC §5.10, scenario 6)", () => {
  it("parent: own children only, age range enforced, one open enrolment per club", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const r = await call(c, "club_request", clubs["Английский язык"], F.children["Алихан"]);
      expect(r.status).toBe("requested");
      await failsWith(c, "select club_request($1, $2)", [clubs["Английский язык"], F.children["Алихан"]], /hs:clubAlreadyEnrolled/);
      await failsWith(c, "select club_request($1, $2)", [clubs["Танцы"], F.children["Алихан"]], /hs:clubAge/);
      await failsWith(c, "select club_request($1, $2)", [clubs["Рисование"], F.children["Миша"]], /forbidden/);
      await become(F.users.parentB);
      await failsWith(c, "select club_request($1, $2)", [clubs["Рисование"], F.children["Алихан"]], /forbidden/);
      await failsWith(c, "select club_request($1, $2)", [clubs["Рисование"], F.children["Саша"]], /forbidden/); // other garden's club
      await become(F.users.head); // staff do not enrol children themselves
      await failsWith(c, "select club_request($1, $2)", [clubs["Рисование"], F.children["Алихан"]], /forbidden/);
    });
  });

  it("full club → queue → a place frees → confirm in queue order only", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into child_guardians (child_id, user_id, kindergarten_id) values ($1, $2, $3) on conflict do nothing", [F.children["Айлин"], F.users.parent, F.A]);
      await c.query("update children set birth_date = '2022-01-01' where id = $1", [F.children["Айлин"]]); // 4 years, fits 4–7
      await become(F.users.parent);
      const a = await call(c, "club_request", clubs["Шахматы"], F.children["Алихан"]);
      expect(a).toMatchObject({ status: "queued", position: 1, queued: 1 });
      const b = await call(c, "club_request", clubs["Шахматы"], F.children["Айлин"]);
      expect(b).toMatchObject({ status: "queued", position: 2, queued: 2 });
      const pos = (await c.query("select * from club_queue_positions($1) order by queue_position", [F.A])).rows;
      expect(pos.map((p) => p.queue_position)).toEqual([1, 2]);
      // nothing to confirm while the club is full
      await become(F.users.head);
      await failsWith(c, "select club_confirm($1)", [a.id], /hs:clubFull/);
      // the head excludes Миша → place frees (audited)
      const misha = (await enrollmentOf(c, "Шахматы", "Миша"))!.id;
      await become(F.users.clubTeacher);
      await failsWith(c, "select club_exclude($1)", [misha], /forbidden/);
      await become(F.users.head);
      const ex = await call(c, "club_exclude", misha, "Переехали");
      expect(ex).toMatchObject({ status: "excluded", freed: true, queued: 2 });
      await c.query("reset role");
      expect((await one(c, "select count(*)::int n from audit_log where action = 'club.exclude' and entity_id = $1", [misha])).n).toBe(1);
      await become(F.users.head);
      // the second in line cannot jump the queue
      await failsWith(c, "select club_confirm($1)", [b.id], /hs:clubQueueOrder/);
      expect(await call(c, "club_confirm", a.id)).toMatchObject({ status: "active", queued: 1 });
      await failsWith(c, "select club_confirm($1)", [b.id], /hs:clubFull/);
      await failsWith(c, "select club_confirm($1)", [a.id], /hs:clubStateChanged/);
      // the club teacher's roster now lists Алихан (enrolled) and no longer Миша
      await become(F.users.clubTeacher);
      const names = (await c.query("select child_name from club_roster($1)", [clubs["Шахматы"]])).rows.map((r) => r.child_name as string);
      expect(names.some((n) => n.includes("Алихан"))).toBe(true);
      expect(names.some((n) => n.includes("Миша"))).toBe(false);
    });
  });

  it("a request confirmed when no place is left goes to the end of the queue; new requests respect the queue", async () => {
    await inTx(async (c, become) => {
      await c.query("update club_enrollments set status = 'left' where club_id = $1 and child_id = $2", [clubs["Рисование"], F.children["Миша"]]);
      await c.query("update clubs set capacity = 2 where id = $1", [clubs["Рисование"]]); // Сабина active, Айлин requested
      await become(F.users.parent);
      const a = await call(c, "club_request", clubs["Рисование"], F.children["Алихан"]);
      expect(a.status).toBe("requested");
      await become(F.users.clubTeacher); // own club
      expect(await call(c, "club_confirm", a.id)).toMatchObject({ status: "active" });
      const ailin = (await enrollmentOf(c, "Рисование", "Айлин"))!.id;
      expect(await call(c, "club_confirm", ailin)).toMatchObject({ status: "queued", position: 1 });
      // capacity grows by one: the queue keeps priority over a new request
      await c.query("reset role");
      await c.query("update clubs set capacity = 3 where id = $1", [clubs["Рисование"]]);
      await c.query("insert into child_guardians (child_id, user_id, kindergarten_id) values ($1, $2, $3) on conflict do nothing", [F.children["Миша"], F.users.parent, F.A]);
      await become(F.users.parent);
      expect(await call(c, "club_request", clubs["Рисование"], F.children["Миша"])).toMatchObject({ status: "queued", position: 2 });
      // shrinking below the active children is refused
      await become(F.users.head);
      await failsWith(c, "update clubs set capacity = 1 where id = $1", [clubs["Рисование"]], /hs:clubCapacityBelowActive/);
    });
  });

  it("club teacher decides only for own clubs; parents leave only their own children", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const eng = await call(c, "club_request", clubs["Английский язык"], F.children["Алихан"]);
      await become(F.users.clubTeacher);
      await failsWith(c, "select club_confirm($1)", [eng.id], /forbidden/);
      await failsWith(c, "select club_reject($1, null)", [eng.id], /forbidden/);
      const ailin = (await enrollmentOf(c, "Рисование", "Айлин"))!.id;
      expect(await call(c, "club_reject", ailin, "Нет мест в этом году")).toMatchObject({ status: "rejected" });
      for (const w of ["teacherParent", "teacher", "accountant", "parentB"] as Who[]) {
        await become(F.users[w]);
        await failsWith(c, "select club_leave($1)", [eng.id], /forbidden/);
        await failsWith(c, "select club_confirm($1)", [eng.id], /forbidden/);
      }
      await c.query("reset role");
      const misha = (await enrollmentOf(c, "Шахматы", "Миша"))!.id;
      await become(F.users.parent);
      await failsWith(c, "select club_leave($1)", [misha], /forbidden/);
      expect(await call(c, "club_leave", eng.id)).toMatchObject({ status: "left", freed: false });
      await become(F.users.teacherParent);
      expect(await call(c, "club_leave", misha)).toMatchObject({ status: "left", freed: true, queued: 0 });
    });
  });

  it("an archived child leaves all clubs and frees the place", async () => {
    await inTx(async (c, become) => {
      await c.query("update children set status = 'archived', archived_at = now() where id = $1", [F.children["Миша"]]);
      const r = await one(c, "select status from club_enrollments where club_id = $1 and child_id = $2 order by created_at desc limit 1", [clubs["Шахматы"], F.children["Миша"]]);
      expect(r.status).toBe("left");
      await become(F.users.head);
      expect((await one(c, "select free from club_stats($1) where club_id = $2", [F.A, clubs["Шахматы"]])).free).toBe(1);
    });
  });
});

describe("clubs · cross-module access stays narrow", () => {
  it("club teacher: enrolled children only through the roster — not their card, history, attendance or documents", async () => {
    await inTx(async (c, become) => {
      const misha = F.children["Миша"];
      await c.query("insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, $2, kg_today($1), 'present') on conflict do nothing", [F.A, misha]);
      const doc = randomUUID();
      await c.query(
        "insert into child_documents (id, kindergarten_id, child_id, category, title, path, mime, size, uploaded_by) values ($1, $2, $3, 'medical', 'Справка', $4, 'application/pdf', 100, $5)",
        [doc, F.A, misha, `${F.A}/${misha}/${randomUUID()}.pdf`, F.users.head],
      );
      await become(F.users.clubTeacher);
      // child_visible is not widened for clubs (only the roster function shows the enrolled children)
      expect((await one(c, "select child_visible($1) v", [misha])).v).toBe(false);
      expect((await c.query("select 1 from child_group_history where child_id = $1", [misha])).rowCount).toBe(0);
      expect((await c.query("select 1 from children where id = $1", [misha])).rowCount).toBe(0);
      expect((await c.query("select 1 from child_guardians where child_id = $1", [misha])).rowCount).toBe(0);
      expect((await c.query("select 1 from child_attendance where child_id = $1", [misha])).rowCount).toBe(0);
      expect((await c.query("select 1 from child_documents where id = $1", [doc])).rowCount).toBe(0);
      expect((await c.query("select 1 from invoices where child_id = $1", [misha])).rowCount).toBe(0);
      expect((await c.query("select 1 from club_roster($1) where child_id = $2", [clubs["Шахматы"], misha])).rowCount).toBe(1);
      // a left child drops off the roster
      await c.query("reset role");
      await c.query("update club_enrollments set status = 'left' where child_id = $1", [misha]);
      await become(F.users.clubTeacher);
      expect((await c.query("select 1 from club_roster($1) where child_id = $2", [clubs["Шахматы"], misha])).rowCount).toBe(0);
    });
  });

  it("club teacher: contacts, allergies and group only for enrolled children; requests and the queue — name and age", async () => {
    await inTx(async (c, become) => {
      const alikhan = F.children["Алихан"]; // allergy «орехи», parent +77010000007
      await c.query("insert into club_enrollments (kindergarten_id, club_id, child_id, status) values ($1, $2, $3, 'requested')", [F.A, clubs["Рисование"], alikhan]);
      const row = async () => one(c, "select * from club_roster($1) where child_id = $2", [clubs["Рисование"], alikhan]);
      await become(F.users.clubTeacher);
      let r = await row();
      expect(r).toMatchObject({ status: "requested", group_name: null, allergies: null, parents: [] });
      expect(r.age).toBeGreaterThanOrEqual(3);
      expect(r).not.toHaveProperty("birth_date");
      // queued: the same
      await c.query("reset role");
      await c.query("update club_enrollments set status = 'queued', queue_no = 1 where club_id = $1 and child_id = $2", [clubs["Рисование"], alikhan]);
      await become(F.users.clubTeacher);
      expect(await row()).toMatchObject({ status: "queued", allergies: null, parents: [] });
      // owner / head / accountant see the full card for requests and the queue
      for (const w of ["owner", "head", "accountant"] as Who[]) {
        await become(F.users[w]);
        r = await row();
        expect(r.allergies).toMatch(/орехи/);
        expect(r.parents.map((p: { phone: string }) => p.phone)).toEqual(["+77010000007"]);
        expect(r.group_name).toBe("Солнышко");
      }
      // enrolled: the club teacher gets contacts and allergies
      await c.query("reset role");
      await c.query("update club_enrollments set status = 'active' where club_id = $1 and child_id = $2", [clubs["Рисование"], alikhan]);
      await become(F.users.clubTeacher);
      r = await row();
      expect(r.allergies).toMatch(/орехи/);
      expect(r.parents.map((p: { phone: string }) => p.phone)).toEqual(["+77010000007"]);
    });
  });

  it("internal counters (free places, queue length, child's age) are not callable by any client", async () => {
    await inTx(async (c, become) => {
      for (const w of ["owner", "head", "clubTeacher", "parent", "teacherParent", "ownerB", "parentB"] as Who[]) {
        await become(F.users[w]);
        await failsWith(c, "select club_free_places($1)", [clubs["Шахматы"]], /permission denied/);
        await failsWith(c, "select club_queued_count($1)", [clubs["Шахматы"]], /permission denied/);
        await failsWith(c, "select club_child_age($1)", [F.children["Миша"]], /permission denied/);
      }
      await failsWith(c, "select club_teaches_child($1)", [F.children["Миша"]], /does not exist/);
      // the transitions that use them keep working (SECURITY DEFINER)
      await become(F.users.parent);
      expect(await call(c, "club_request", clubs["Английский язык"], F.children["Алихан"])).toMatchObject({ status: "requested", queued: 0 });
    });
  });

  it("parent may start a chat with the club teacher only while the child attends the club", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      expect(await rejects(c, "select start_direct_chat($1, $2)", [F.A, F.users.clubTeacher])).toBe(true);
      await c.query("reset role");
      await c.query("insert into club_enrollments (kindergarten_id, club_id, child_id, status) values ($1, $2, $3, 'requested')", [F.A, clubs["Рисование"], F.children["Алихан"]]);
      await become(F.users.parent);
      expect(await rejects(c, "select start_direct_chat($1, $2)", [F.A, F.users.clubTeacher])).toBe(true); // only a request
      await c.query("reset role");
      await c.query("update club_enrollments set status = 'active' where child_id = $1 and club_id = $2", [F.children["Алихан"], clubs["Рисование"]]);
      await become(F.users.parent);
      expect((await one(c, "select start_direct_chat($1, $2) id", [F.A, F.users.clubTeacher])).id).toBeTruthy();
      // still no parent ↔ parent
      expect(await rejects(c, "select start_direct_chat($1, $2)", [F.A, F.users.teacherParent])).toBe(true);
      // and the club teacher (staff) may write to any parent of the garden, as before
      await become(F.users.clubTeacher);
      expect((await one(c, "select start_direct_chat($1, $2) id", [F.A, F.users.parent])).id).toBeTruthy();
    });
  });
});

describe("clubs · concurrency", () => {
  const made: string[] = [];
  afterAll(async () => {
    await admin(async (c) => {
      if (made.length) await c.query("delete from clubs where id = any($1)", [made]);
    });
  });

  it("two confirmations for the last place: exactly one wins, the other goes to the queue", async () => {
    const { club, e1, e2 } = await admin(async (c) => {
      const club = (await c.query("insert into clubs (kindergarten_id, name, age_from, age_to, capacity) values ($1, $2, 3, 7, 1) returning id", [F.A, `Гонка ${randomUUID().slice(0, 6)}`])).rows[0].id as string;
      made.push(club);
      const ins = "insert into club_enrollments (kindergarten_id, club_id, child_id, status) values ($1, $2, $3, 'requested') returning id";
      const e1 = (await c.query(ins, [F.A, club, F.children["Алихан"]])).rows[0].id as string;
      const e2 = (await c.query(ins, [F.A, club, F.children["Айлин"]])).rows[0].id as string;
      return { club, e1, e2 };
    });
    const asHead = async (cl: PoolClient) => {
      await cl.query("begin");
      await cl.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: F.users.head, role: "authenticated" })]);
      await cl.query("set local role authenticated");
    };
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await asHead(c1);
      await asHead(c2);
      const r1 = (await c1.query("select club_confirm($1) r", [e1])).rows[0].r;
      const p2 = c2.query("select club_confirm($1) r", [e2]); // blocks on the club lock
      await new Promise((r) => setTimeout(r, 200));
      await c1.query("commit");
      const r2 = (await p2).rows[0].r;
      await c2.query("commit");
      expect(r1.status).toBe("active");
      expect(r2.status).toBe("queued");
    } finally {
      c1.release();
      c2.release();
    }
    await admin(async (c) => {
      const s = (await c.query("select status, count(*)::int n from club_enrollments where club_id = $1 group by status order by status", [club])).rows;
      expect(s).toEqual([{ status: "active", n: 1 }, { status: "queued", n: 1 }]);
    });
  });
});

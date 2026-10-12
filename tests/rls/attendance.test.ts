import { beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { asUser, inTx, rejects } from "./db";
import { fx } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const today = async (c: PoolClient) => (await c.query("select kg_today($1)::text as d", [F.A])).rows[0].d as string;
const n = async (c: PoolClient, sql: string, params: unknown[] = []) => Number((await c.query(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);
const mark = (child: string, status: "present" | "absent", date = "kg_today($1)") =>
  `insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, '${child}', ${date}, '${status}')
   on conflict (child_id, date) do update set status = excluded.status`;

describe("child_attendance", () => {
  it("teacher marks own group today; not other groups, not past days", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      await c.query(mark(F.children["Алихан"], "present"), [F.A]);
      const row = (await c.query("select group_id, marked_by from child_attendance where child_id = $1 and date = kg_today($2)", [F.children["Алихан"], F.A])).rows[0];
      expect(row.group_id).toBe(F.gA1); // set by trigger, not by the client
      expect(row.marked_by).toBe(F.users.teacher);
      // re-mark (upsert) works
      await c.query(mark(F.children["Алихан"], "absent"), [F.A]);
      // other group's child
      expect(await rejects(c, mark(F.children["Сабина"], "present"), [F.A])).toBe(true);
      // past day
      expect(await rejects(c, mark(F.children["Айлин"], "present", "kg_today($1) - 1"), [F.A])).toBe(true);
      // future day
      expect(await rejects(c, mark(F.children["Айлин"], "present", "kg_today($1) + 1"), [F.A])).toBe(true);
      // cannot forge group or author
      expect(await rejects(c, "update child_attendance set group_id = $1", [F.gA2])).toBe(true);
      expect(await rejects(c, "update child_attendance set marked_by = $1", [F.users.head])).toBe(true);
    });
  });

  it("teacher cannot edit a past day row of own group", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, $2, kg_today($1) - 1, 'present') on conflict do nothing", [
        F.A,
        F.children["Айлин"],
      ]);
      await become(F.users.teacher);
      expect(await n(c, "select 1 from child_attendance where child_id = $1 and date = kg_today($2) - 1", [F.children["Айлин"], F.A])).toBe(1);
      const upd = await c.query("update child_attendance set status = 'absent' where child_id = $1 and date = kg_today($2) - 1", [F.children["Айлин"], F.A]);
      expect(upd.rowCount).toBe(0);
      const del = await c.query("delete from child_attendance where child_id = $1 and date = kg_today($2) - 1", [F.children["Айлин"], F.A]);
      expect(del.rowCount).toBe(0);
    });
  });

  it("head edits past days and every change is audited", async () => {
    await inTx(async (c, become) => {
      await become(F.users.head);
      await c.query(mark(F.children["Сабина"], "absent", "kg_today($1) - 3"), [F.A]);
      await c.query(mark(F.children["Сабина"], "present", "kg_today($1) - 3"), [F.A]);
      await c.query(mark(F.children["Сабина"], "present"), [F.A]); // today: not audited
      expect(
        await n(c, "select 1 from audit_log where kindergarten_id = $1 and action = 'attendance.edit_past' and entity_id = $2 and actor_id = $3", [
          F.A,
          F.children["Сабина"],
          F.users.head,
        ]),
      ).toBe(2);
    });
  });

  it("parent sees only own children's rows; accountant reads but cannot write; cook and club teacher see nothing", async () => {
    await inTx(async (c, become) => {
      for (const ch of ["Алихан", "Миша", "Сабина"]) {
        await c.query("insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, $2, kg_today($1), 'present') on conflict do nothing", [F.A, F.children[ch]]);
      }
      await become(F.users.parent);
      const ids = new Set((await c.query("select child_id from child_attendance")).rows.map((r) => r.child_id));
      expect([...ids]).toEqual([F.children["Алихан"]]);
      expect(await rejects(c, mark(F.children["Алихан"], "absent"), [F.A])).toBe(true);

      await become(F.users.accountant);
      expect(await n(c, "select 1 from child_attendance where date = kg_today($1)", [F.A])).toBeGreaterThanOrEqual(3);
      expect(await rejects(c, mark(F.children["Айлин"], "present"), [F.A])).toBe(true);
      expect((await c.query("update child_attendance set status = 'absent' where kindergarten_id = $1", [F.A])).rowCount).toBe(0);

      for (const who of ["cook", "clubTeacher"] as const) {
        await become(F.users[who]);
        expect(await n(c, "select 1 from child_attendance")).toBe(0);
        expect(await rejects(c, mark(F.children["Айлин"], "present"), [F.A])).toBe(true);
      }

      await become(F.users.teacher); // sees own group only
      const groups = new Set((await c.query("select group_id from child_attendance")).rows.map((r) => r.group_id));
      expect([...groups]).toEqual([F.gA1]);
    });
  });

  it("other kindergarten cannot mark or see", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, $2, kg_today($1), 'present') on conflict do nothing", [F.A, F.children["Алихан"]]);
      await become(F.users.ownerB);
      expect(await n(c, "select 1 from child_attendance where kindergarten_id = $1", [F.A])).toBe(0);
      expect(await rejects(c, mark(F.children["Айлин"], "present"), [F.A])).toBe(true);
      // forged kindergarten id on own row
      expect(
        await rejects(c, "insert into child_attendance (kindergarten_id, child_id, date, status) values ($1, $2, kg_today($1), 'present')", [F.B, F.children["Айлин"]]),
      ).toBe(true);
    });
  });
});

describe("absence_reports", () => {
  const report = (child: string, from = "kg_today($1) + 1", to = "kg_today($1) + 3", reason = "sick") =>
    `insert into absence_reports (kindergarten_id, child_id, date_from, date_to, reason) values ($1, '${child}', ${from}, ${to}, '${reason}') returning id, created_by`;

  it("parent reports only for own children, not for past days, no overlaps", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const r = (await c.query(report(F.children["Алихан"]), [F.A])).rows[0];
      expect(r.created_by).toBe(F.users.parent);
      expect(await rejects(c, report(F.children["Айлин"]), [F.A])).toBe(true);
      expect(await rejects(c, report(F.children["Алихан"], "kg_today($1) - 1", "kg_today($1)"), [F.A])).toBe(true);
      expect(await rejects(c, report(F.children["Алихан"], "kg_today($1) + 2", "kg_today($1) + 5"), [F.A])).toBe(true); // overlap
      expect(await rejects(c, "update absence_reports set reason = 'other'")).toBe(true);
      expect(await rejects(c, "delete from absence_reports")).toBe(true);
      // sees only own child's reports
      await c.query("reset role");
      await c.query(report(F.children["Айлин"]), [F.A]);
      await become(F.users.parent);
      expect([...new Set((await c.query("select child_id from absence_reports")).rows.map((x) => x.child_id))]).toEqual([F.children["Алихан"]]);
      // teacher of the group sees both, teacher of another group none of them, cook none
      await become(F.users.teacher);
      expect(await n(c, "select 1 from absence_reports where date_from = kg_today($1) + 1", [F.A])).toBe(2);
      await become(F.users.cook);
      expect(await n(c, "select 1 from absence_reports")).toBe(0);
      await become(F.users.parentB);
      expect(await n(c, "select 1 from absence_reports where kindergarten_id = $1", [F.A])).toBe(0);
      expect(await rejects(c, report(F.children["Алихан"]), [F.A])).toBe(true);
    });
  });

  it("parent cancels before the day starts; a started period is shortened; other parents cannot cancel", async () => {
    await inTx(async (c, become) => {
      await become(F.users.parent);
      const future = (await c.query(report(F.children["Алихан"], "kg_today($1) + 1", "kg_today($1) + 2"), [F.A])).rows[0].id;
      await become(F.users.teacherParent);
      expect(await rejects(c, "select cancel_absence_report($1)", [future])).toBe(true);
      await become(F.users.parent);
      await c.query("select cancel_absence_report($1)", [future]);
      expect((await c.query("select cancelled_at from absence_reports where id = $1", [future])).rows[0].cancelled_at).not.toBeNull();

      await c.query("reset role");
      const started = (await c.query(report(F.children["Алихан"], "kg_today($1) - 1", "kg_today($1) + 2"), [F.A])).rows[0].id;
      const todayOnly = (await c.query(report(F.children["Алихан"], "kg_today($1) - 5", "kg_today($1) - 4"), [F.A])).rows[0].id;
      await become(F.users.parent);
      await c.query("select cancel_absence_report($1)", [started]);
      const s = (await c.query("select cancelled_at, date_to::text from absence_reports where id = $1", [started])).rows[0];
      expect(s.cancelled_at).toBeNull();
      expect(s.date_to).toBe(await today(c));
      expect(await rejects(c, "select cancel_absence_report($1)", [todayOnly])).toBe(true);
    });
  });

  it("marking absent picks up the reason of the parent's report", async () => {
    await inTx(async (c, become) => {
      await c.query(report(F.children["Айлин"], "kg_today($1)", "kg_today($1) + 2", "vacation"), [F.A]);
      await become(F.users.teacher);
      await c.query(mark(F.children["Айлин"], "absent"), [F.A]);
      const r = (await c.query("select reason, absence_report_id from child_attendance where child_id = $1 and date = kg_today($2)", [F.children["Айлин"], F.A])).rows[0];
      expect(r.reason).toBe("vacation");
      expect(r.absence_report_id).not.toBeNull();
    });
  });
});

describe("expected_portions", () => {
  const portions = (c: PoolClient) => c.query("select * from expected_portions($1, kg_today($1))", [F.A]).then((r) => r.rows);

  it("cook gets numbers per group; reports reduce, marking replaces", async () => {
    await inTx(async (c, become) => {
      await c.query("delete from child_attendance where date = kg_today($1)", [F.A]);
      await c.query("delete from absence_reports where kindergarten_id = $1", [F.A]);
      await become(F.users.cook);
      let g = (await portions(c)).find((r) => r.group_id === F.gA1);
      expect(g).toMatchObject({ active: 3, reported: 0, marked: 0, present: null, expected: 3 });
      expect(Object.keys(g)).not.toContain("full_name");

      await c.query("reset role");
      await c.query("insert into absence_reports (kindergarten_id, child_id, date_from, date_to, reason) values ($1, $2, kg_today($1), kg_today($1) + 2, 'sick')", [
        F.A,
        F.children["Алихан"],
      ]);
      await become(F.users.cook);
      g = (await portions(c)).find((r) => r.group_id === F.gA1);
      expect(g).toMatchObject({ active: 3, reported: 1, present: null, expected: 2 });

      await become(F.users.teacher);
      await c.query(mark(F.children["Миша"], "present"), [F.A]);
      await c.query(mark(F.children["Айлин"], "absent"), [F.A]);
      await become(F.users.cook);
      g = (await portions(c)).find((r) => r.group_id === F.gA1);
      expect(g).toMatchObject({ marked: 2, present: 1, absent: 2, expected: 1 });
    });
  });

  it("works for staff only: parent, anon and other kindergarten fail", async () => {
    await inTx(async (c, become) => {
      for (const who of ["owner", "head", "accountant", "teacher", "cook"] as const) {
        await become(F.users[who]);
        expect((await portions(c)).length).toBe(2);
      }
      for (const who of ["parent", "ownerB"] as const) {
        await become(F.users[who]);
        expect(await rejects(c, "select * from expected_portions($1, current_date)", [F.A])).toBe(true);
      }
    });
    await asUser(null, async (c) => {
      expect(await rejects(c, "select * from expected_portions($1, current_date)", [F.A])).toBe(true);
    });
  });
});

describe("attendance_roster", () => {
  it("respects group history and the caller's rights", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      const names = (await c.query("select full_name from attendance_roster($1, kg_today($2), kg_today($2))", [F.gA1, F.A])).rows;
      expect(names.length).toBe(3);
      expect((await c.query("select 1 from attendance_roster($1, kg_today($2), kg_today($2))", [F.gA2, F.A])).rowCount).toBe(0);
      await become(F.users.cook);
      expect((await c.query("select 1 from attendance_roster($1, kg_today($2), kg_today($2))", [F.gA1, F.A])).rowCount).toBe(0);
      // transfer Айлин to Звёздочки from tomorrow: today she's still in Солнышко, tomorrow not
      await become(F.users.head);
      await c.query("select transfer_child($1, $2, kg_today($3) + 1)", [F.children["Айлин"], F.gA2, F.A]);
      const r = await c.query("select child_id, in_from::text, in_to::text from attendance_roster($1, kg_today($2) - 1, kg_today($2) + 1) where child_id = $3", [
        F.gA1,
        F.A,
        F.children["Айлин"],
      ]);
      expect(r.rows[0].in_to).toBe(await today(c));
    });
  });
});

describe("attendance reminders", () => {
  // Fixed Monday 2030-01-07 (working day) in Asia/Almaty (UTC+5).
  const at = (local: string) => `2030-01-07T${local}:00+05:00`;
  const due = (c: PoolClient, ts: string) =>
    c.query("select group_id, level from attendance_reminders_due($1::timestamptz) where kindergarten_id = $2", [ts, F.A]).then((r) => r.rows);

  it("teacher level after reminder time, head level after escalation, once per group/day/level, only on working days", async () => {
    await inTx(async (c) => {
      expect(await due(c, at("09:30"))).toEqual([]);
      const ten = await due(c, at("10:05"));
      expect(ten.filter((r) => r.level === "teacher").length).toBe(2);
      expect(ten.filter((r) => r.level === "head").length).toBe(0);
      // group gA2 fully marked → no reminder for it
      // (an attendance row in the future is rejected, so a parent's report stands in for marking)
      await c.query("insert into absence_reports (kindergarten_id, child_id, date_from, date_to, reason) values ($1, $2, '2030-01-07', '2030-01-07', 'other')", [
        F.A,
        F.children["Сабина"],
      ]);
      expect((await due(c, at("10:05"))).map((r) => r.group_id)).toEqual([F.gA1]);
      // sent → not again
      await c.query("insert into attendance_reminders (kindergarten_id, group_id, date, level) values ($1, $2, '2030-01-07', 'teacher')", [F.A, F.gA1]);
      expect(await due(c, at("10:30"))).toEqual([]);
      expect(await due(c, at("11:15"))).toEqual([{ group_id: F.gA1, level: "head" }]);
      // weekend and holidays: nothing
      expect(await due(c, "2030-01-05T11:30:00+05:00")).toEqual([]);
      await c.query("insert into holidays (kindergarten_id, date, name) values ($1, '2030-01-07', 'Праздник')", [F.A]);
      expect(await due(c, at("11:15"))).toEqual([]);
    });
  });

  it("is not callable by app users", async () => {
    await asUser(F.users.owner, async (c) => {
      expect(await rejects(c, "select * from attendance_reminders_due()")).toBe(true);
      expect(await rejects(c, "select * from attendance_reminders")).toBe(false);
      expect((await c.query("select 1 from attendance_reminders")).rowCount).toBe(0);
    });
  });
});

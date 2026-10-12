import { beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { inTx, rejects } from "./db";
import { fx } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const DAY = "2025-03-03"; // a Monday long ago; fixtures give garden A staff Mon–Fri 08:00–17:00
const at = (time: string, day = DAY) => `${day}T${time}:00+05:00`;

async function addSession(c: PoolClient, user: string, start: string, end: string | null, kg = F.A, day = DAY) {
  const r = await c.query(
    "insert into work_sessions (kindergarten_id, user_id, work_date, started_at, ended_at) values ($1, $2, $3, $4, $5) returning id",
    [kg, user, day, start, end],
  );
  return r.rows[0].id as string;
}

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

describe("work_sessions visibility", () => {
  it("staff see only their own rows, admins and the accountant see all, parents and other gardens nothing", async () => {
    await inTx(async (c, become) => {
      await addSession(c, F.users.cook, at("08:00"), at("17:00"));
      await addSession(c, F.users.teacher, at("08:00"), at("17:00"));
      const users = async () => (await c.query("select distinct user_id from work_sessions where kindergarten_id = $1 and work_date = $2", [F.A, DAY])).rows.map((r) => r.user_id).sort();

      await become(F.users.teacher);
      expect(await users()).toEqual([F.users.teacher]);
      await become(F.users.cook);
      expect(await users()).toEqual([F.users.cook]);
      for (const who of [F.users.head, F.users.owner, F.users.accountant]) {
        await become(who);
        expect(await users()).toEqual([F.users.cook, F.users.teacher].sort());
      }
      await become(F.users.parent);
      expect(await users()).toEqual([]);
      for (const t of ["staff_schedules", "schedule_overrides", "staff_absences", "work_sessions"]) {
        expect((await c.query(`select 1 from ${t}`)).rowCount, t).toBe(0);
      }
      await become(F.users.ownerB);
      expect(await users()).toEqual([]);
      expect((await c.query("select 1 from staff_schedules where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
    });
  });

  it("worktime_range: everyone for owner/head/accountant, self for staff, nothing for parents and other gardens", async () => {
    await inTx(async (c, become) => {
      const people = async () => new Set((await c.query("select user_id from worktime_range($1, $2, $2)", [F.A, DAY])).rows.map((r) => r.user_id)).size;
      await become(F.users.head);
      expect(await people()).toBeGreaterThanOrEqual(7);
      await become(F.users.accountant);
      expect(await people()).toBeGreaterThanOrEqual(7);
      await become(F.users.teacher);
      expect((await c.query("select user_id from worktime_range($1, $2, $2)", [F.A, DAY])).rows.map((r) => r.user_id)).toEqual([F.users.teacher]);
      await become(F.users.parent);
      expect(await people()).toBe(0);
      await become(F.users.ownerB);
      expect(await people()).toBe(0);
      await become(null);
      expect(await rejects(c, "select * from worktime_range($1, $2, $2)", [F.A, DAY])).toBe(true);
    });
  });
});

describe("work_sessions writes", () => {
  it("nobody inserts or rewrites times directly — not even owner/head", async () => {
    await inTx(async (c, become) => {
      const id = await addSession(c, F.users.cook, at("08:00"), at("17:00"));
      for (const who of [F.users.cook, F.users.teacher, F.users.accountant, F.users.head, F.users.owner, F.users.parent]) {
        await become(who);
        expect(await rejects(c, "insert into work_sessions (kindergarten_id, user_id, work_date, started_at) values ($1, $2, $3, $4)", [F.A, who, DAY, at("06:00")])).toBe(true);
        expect(await rejects(c, "update work_sessions set started_at = $2 where id = $1", [id, at("07:00")])).toBe(true);
        expect(await rejects(c, "delete from work_sessions where id = $1", [id])).toBe(true);
      }
    });
  });

  it("start/finish take the server time; a second start opens a new interval; archived staff and parents cannot start", async () => {
    await inTx(async (c, become) => {
      await c.query("delete from work_sessions where user_id = $1", [F.users.cook]);
      await become(F.users.cook);
      const s = (await c.query("select started_at = now() as server_time, ended_at from worktime_start($1)", [F.A])).rows[0];
      expect(s.server_time).toBe(true);
      expect(s.ended_at).toBeNull();
      expect(await errorOf(c, "select worktime_start($1)", [F.A])).toMatch(/hs:worktimeAlreadyStarted/);
      expect((await c.query("select ended_at = now() as ok from worktime_finish($1)", [F.A])).rows[0].ok).toBe(true);
      expect(await errorOf(c, "select worktime_finish($1)", [F.A])).toMatch(/hs:worktimeNotStarted/);
      await c.query("select worktime_start($1)", [F.A]);
      expect((await c.query("select count(*)::int as n from work_sessions where user_id = $1", [F.users.cook])).rows[0].n).toBe(2);
      // another garden
      expect(await rejects(c, "select worktime_start($1)", [F.B])).toBe(true);

      await become(F.users.parent);
      expect(await rejects(c, "select worktime_start($1)", [F.A])).toBe(true);

      await become(null);
      expect(await rejects(c, "select worktime_start($1)", [F.A])).toBe(true);

      await c.query("reset role");
      await c.query("update memberships set status = 'archived', archived_at = now() where user_id = $1 and kindergarten_id = $2", [F.users.clubTeacher, F.A]);
      await c.query("delete from work_sessions where user_id = $1", [F.users.clubTeacher]);
      await become(F.users.clubTeacher);
      expect(await rejects(c, "select worktime_start($1)", [F.A])).toBe(true);
    });
  });

  it("head/owner corrections require a comment, mark the row edited and are audited; others cannot correct", async () => {
    await inTx(async (c, become) => {
      const id = await addSession(c, F.users.cook, at("08:40"), at("17:00"));
      await become(F.users.head);
      expect(await errorOf(c, "select worktime_edit_session($1, $2, '08:00', '17:00', '')", [id, DAY])).toMatch(/hs:commentRequired/);
      expect(await errorOf(c, "select worktime_edit_session($1, $2, '18:00', '17:00', 'ошибка')", [id, DAY])).toMatch(/hs:worktimeTimeOrder/);
      const r = (await c.query("select * from worktime_edit_session($1, $2, '08:00', '17:00', 'Забыла отметиться')", [id, DAY])).rows[0];
      expect(r.edited).toBe(true);
      expect(r.edit_comment).toBe("Забыла отметиться");
      expect(new Date(r.started_at).toISOString()).toBe(new Date(at("08:00")).toISOString());
      // overlapping manual interval is refused, a separate one is fine
      expect(await errorOf(c, "select worktime_add_session($1, $2, $3, '12:00', '13:00', 'вторая смена')", [F.A, F.users.cook, DAY])).toMatch(/hs:worktimeOverlap/);
      await c.query("select worktime_add_session($1, $2, $3, '18:00', '19:00', 'вечернее мероприятие')", [F.A, F.users.cook, DAY]);
      expect(await errorOf(c, "select worktime_add_session($1, $2, $3, '08:00', '09:00', 'не наш')", [F.A, F.users.parent, DAY])).not.toBeNull();
      const audit = await c.query("select count(*)::int as n from audit_log where kindergarten_id = $1 and action = 'worktime.edit' and created_at = now()", [F.A]);
      expect(audit.rows[0].n).toBe(2);

      for (const who of [F.users.accountant, F.users.teacher, F.users.cook, F.users.parent, F.users.ownerB]) {
        await become(who);
        expect(await rejects(c, "select worktime_edit_session($1, $2, '08:00', '16:00', 'попытка правки')", [id, DAY])).toBe(true);
        expect(await rejects(c, "select worktime_add_session($1, $2, $3, '20:00', '21:00', 'попытка правки')", [F.A, who, DAY])).toBe(true);
      }
    });
  });
});

describe("schedules, overrides, absences", () => {
  it("only owner/head of the garden edit them; cook and accountant cannot", async () => {
    await inTx(async (c, become) => {
      for (const who of [F.users.cook, F.users.accountant, F.users.teacher, F.users.parent]) {
        await become(who);
        expect(await rejects(c, "insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time) values ($1, $2, 6, '09:00', '12:00')", [F.A, F.users.cook])).toBe(true);
        expect((await c.query("update staff_schedules set end_time = '23:00' where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
        expect((await c.query("delete from staff_schedules where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
        expect(await rejects(c, "insert into schedule_overrides (kindergarten_id, user_id, date, kind) values ($1, $2, $3, 'day_off')", [F.A, F.users.cook, DAY])).toBe(true);
        expect(await rejects(c, "insert into staff_absences (kindergarten_id, user_id, kind, date_from, date_to) values ($1, $2, 'sick', $3, $3)", [F.A, F.users.cook, DAY])).toBe(true);
      }
      await become(F.users.head);
      await c.query("insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time) values ($1, $2, 6, '09:00', '12:00')", [F.A, F.users.cook]);
      await c.query("insert into schedule_overrides (kindergarten_id, user_id, date, kind) values ($1, $2, $3, 'day_off')", [F.A, F.users.cook, DAY]);
      await c.query("insert into staff_absences (kindergarten_id, user_id, kind, date_from, date_to) values ($1, $2, 'sick', $3, $3)", [F.A, F.users.teacher, DAY]);
      // a parent or a person of another garden cannot be scheduled
      expect(await rejects(c, "insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time) values ($1, $2, 6, '09:00', '12:00')", [F.A, F.users.parent])).toBe(true);
      expect(await rejects(c, "insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time) values ($1, $2, 6, '09:00', '12:00')", [F.B, F.users.ownerB])).toBe(true);
      await become(F.users.cook);
      expect((await c.query("select 1 from staff_schedules where user_id = $1", [F.users.cook])).rowCount).toBe(6);
      expect((await c.query("select 1 from staff_absences")).rowCount).toBe(0);
    });
  });
});

describe("day statuses (worktime_range)", () => {
  it("late / on time / absent / unmarked / outside schedule / holiday", async () => {
    await inTx(async (c, become) => {
      const SAT = "2025-03-08"; // Saturday (and Women's day)
      await c.query("delete from work_sessions where work_date in ($1, $2)", [DAY, SAT]);
      await addSession(c, F.users.teacher, at("08:25"), at("17:00")); // late 25 > 10
      await addSession(c, F.users.cook, at("08:05"), at("12:00")); // within threshold
      await addSession(c, F.users.cook, at("13:00"), at("17:30")); // second interval
      await c.query("insert into staff_absences (kindergarten_id, user_id, kind, date_from, date_to) values ($1, $2, 'vacation', $3, $3)", [F.A, F.users.clubTeacher, DAY]);
      await addSession(c, F.users.head, at("10:00", SAT), at("12:00", SAT), F.A, SAT); // weekend work
      await c.query("insert into schedule_overrides (kindergarten_id, user_id, date, kind) values ($1, $2, $3, 'day_off')", [F.A, F.users.accountant, DAY]);
      await become(F.users.owner);
      const q = async (d: string) =>
        Object.fromEntries((await c.query("select * from worktime_range($1, $2, $2)", [F.A, d])).rows.map((r) => [r.user_id, r]));
      const d = await q(DAY);
      expect(d[F.users.teacher].status).toBe("late");
      expect(d[F.users.teacher].late_minutes).toBe(25);
      expect(d[F.users.cook].status).toBe("done");
      expect(d[F.users.cook].worked_minutes).toBe(235 + 270);
      expect(d[F.users.cook].sessions).toHaveLength(2);
      expect(d[F.users.clubTeacher].status).toBe("absent");
      expect(d[F.users.clubTeacher].absence_kind).toBe("vacation");
      expect(d[F.users.teacherParent].status).toBe("unmarked");
      expect(d[F.users.accountant].status).toBe("off"); // day off override
      expect(d[F.users.owner].status).toBe("off"); // owner has no schedule
      const s = await q(SAT);
      expect(s[F.users.head].status).toBe("done");
      expect(s[F.users.head].outside_schedule).toBe(true);
      expect(s[F.users.head].late_minutes).toBe(0);
      expect(s[F.users.teacherParent].status).toBe("off");

      // a kindergarten holiday on a weekday: nobody is expected
      await c.query("reset role");
      await c.query("insert into holidays (kindergarten_id, date, name) values ($1, '2025-03-04', 'Тест')", [F.A]);
      await become(F.users.owner);
      const h = await q("2025-03-04");
      expect(h[F.users.teacherParent].status).toBe("off");
      expect(h[F.users.teacherParent].is_holiday).toBe(true);
    });
  });

  it("archived staff keep their past days but are not expected after archiving", async () => {
    await inTx(async (c, become) => {
      await addSession(c, F.users.clubTeacher, at("08:00"), at("17:00"));
      await c.query("update memberships set status = 'archived', archived_at = $3 where user_id = $1 and kindergarten_id = $2", [F.users.clubTeacher, F.A, "2025-03-05T12:00:00+05:00"]);
      await become(F.users.accountant);
      const rows = (await c.query("select work_date::text as d, status, archived from worktime_range($1, '2025-03-03', '2025-03-07') where user_id = $2", [F.A, F.users.clubTeacher])).rows;
      expect(rows.map((r) => r.d)).toEqual(["2025-03-03", "2025-03-04"]);
      expect(rows[0].status).toBe("done");
      expect(rows[0].archived).toBe(true);
    });
  });
});

describe("auto-close", () => {
  it("closes a forgotten interval at shift end after +2h, flags and audits it, is idempotent and service-only", async () => {
    await inTx(async (c, become) => {
      await c.query("delete from work_sessions where user_id in ($1, $2)", [F.users.cook, F.users.teacher]);
      const id = await addSession(c, F.users.cook, at("08:00"), null);
      const extra = await addSession(c, F.users.teacher, at("10:00", "2025-03-08"), null, F.A, "2025-03-08"); // Saturday, no shift
      const run = async (now: string) => (await c.query("select * from worktime_autoclose($1)", [now])).rows;
      expect(await run(at("18:59"))).toHaveLength(0); // shift end 17:00 + 2h not reached
      const closed = await run(at("19:00"));
      expect(closed.map((r) => r.session_id)).toEqual([id]);
      const s = (await c.query("select ended_at, auto_closed from work_sessions where id = $1", [id])).rows[0];
      expect(new Date(s.ended_at).toISOString()).toBe(new Date(at("17:00")).toISOString());
      expect(s.auto_closed).toBe(true);
      expect((await c.query("select 1 from audit_log where action = 'worktime.auto_close' and entity_id = $1", [id])).rowCount).toBe(1);
      expect(await run(at("23:00"))).toHaveLength(0); // idempotent

      // no shift: closed at its start (0 h) after the local day + 2h
      expect(await run(at("01:59", "2025-03-09"))).toHaveLength(0);
      const r2 = await run(at("02:00", "2025-03-09"));
      expect(r2.map((r) => r.session_id)).toEqual([extra]);
      const e = (await c.query("select ended_at = started_at as zero from work_sessions where id = $1", [extra])).rows[0];
      expect(e.zero).toBe(true);

      for (const who of [F.users.head, F.users.owner, F.users.cook]) {
        await become(who);
        expect(await rejects(c, "select * from worktime_autoclose()")).toBe(true);
      }
    });
  });
});

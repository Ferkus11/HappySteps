import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const FNS = ["attendance", "staff", "finance", "funnel"] as const;
type Fn = (typeof FNS)[number];
const RANGE = ["2026-09-01", "2026-09-30"];

/** Whether the caller may run analytics_<fn>(kg, …) — keeps the transaction usable after a refusal. */
async function allowed(c: PoolClient, fn: Fn, kg: string): Promise<boolean> {
  await c.query("savepoint a");
  try {
    await c.query(`select * from analytics_${fn}($1, $2, $3)`, [kg, ...RANGE]);
    await c.query("release savepoint a");
    return true;
  } catch (e) {
    await c.query("rollback to savepoint a");
    expect(String((e as Error).message)).toMatch(/hs:forbidden|permission denied/);
    return false;
  }
}

describe("analytics · who may call (SPEC §3.4 «Аналитика»)", () => {
  it("owner everything, head without finances, accountant finances only, everybody else nothing", async () => {
    const expected: Record<Who, Fn[]> = {
      owner: ["attendance", "staff", "finance", "funnel"],
      head: ["attendance", "staff", "funnel"],
      accountant: ["finance"],
      teacher: [],
      clubTeacher: [],
      cook: [],
      parent: [],
      teacherParent: [],
      ownerB: [],
      parentB: [],
      superadmin: [],
    };
    for (const [who, fns] of Object.entries(expected) as [Who, Fn[]][]) {
      await asUser(F.users[who], async (c) => {
        const got: Fn[] = [];
        for (const fn of FNS) if (await allowed(c, fn, F.A)) got.push(fn);
        expect(got, who).toEqual(fns);
      });
    }
  });

  it("anonymous callers cannot even execute the functions", async () => {
    await asUser(null, async (c) => {
      for (const fn of FNS) {
        await c.query("savepoint a");
        await expect(c.query(`select * from analytics_${fn}($1, $2, $3)`, [F.A, ...RANGE])).rejects.toThrow(/permission denied/);
        await c.query("rollback to savepoint a");
      }
    });
  });

  it("garden isolation: owner of B gets B's numbers, never A's", async () => {
    await asUser(F.users.ownerB, async (c) => {
      for (const fn of FNS) expect(await allowed(c, fn, F.B), fn).toBe(true);
      const fin = (await c.query("select analytics_finance($1, '2026-09-01', '2026-10-31') as r", [F.B])).rows[0].r;
      const names = fin.debtors.map((d: { full_name: string }) => d.full_name);
      expect(names.some((n: string) => /Алихан|Сабина|Айлин|Миша/.test(n))).toBe(false);
    });
    await asUser(F.users.owner, async (c) => {
      for (const fn of FNS) expect(await allowed(c, fn, F.B), fn).toBe(false);
    });
  });

  it("rejects a reversed or too long period", async () => {
    await asUser(F.users.owner, async (c) => {
      for (const [from, to] of [["2026-10-01", "2026-09-01"], ["2025-01-01", "2026-10-01"]]) {
        await c.query("savepoint a");
        await expect(c.query("select analytics_attendance($1, $2, $3)", [F.A, from, to])).rejects.toThrow(/hs:invalid/);
        await c.query("rollback to savepoint a");
      }
    });
  });
});

/**
 * A small known dataset in garden B, in 2025 (before any fixture child of B was enrolled), inside a rolled-back
 * transaction: group «Аналитика» with three children enrolled 01.09.2025, one week of attendance, parent reports,
 * a staff week of the owner, two invoices and a receipt, four waitlist applications and one child leaving.
 */
async function dataset(c: PoolClient) {
  await c.query("reset role");
  const B = F.B;
  const g = (await c.query("insert into groups (kindergarten_id, name, capacity) values ($1, 'Аналитика', 4) returning id", [B])).rows[0].id as string;
  const kid = async (name: string, fee: number) =>
    (
      await c.query("insert into children (kindergarten_id, full_name, birth_date, group_id, enrolled_on, monthly_fee) values ($1, $2, '2021-01-01', $3, '2025-09-01', $4) returning id", [
        B,
        name,
        g,
        fee,
      ])
    ).rows[0].id as string;
  const k1 = await kid("Тестов Первый", 50000);
  const k2 = await kid("Тестов Второй", 0);
  const k3 = await kid("Тестов Третий", 0);
  const mark = (child: string, date: string, status: string, reason: string | null = null) =>
    c.query("insert into child_attendance (kindergarten_id, child_id, group_id, date, status, reason) values ($1, $2, $3, $4, $5, $6)", [B, child, g, date, status, reason]);
  // week Mon 15.09.2025 – Fri 19.09.2025
  for (const d of ["2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18", "2025-09-19"]) await mark(k1, d, "present");
  await mark(k2, "2025-09-15", "present");
  await mark(k2, "2025-09-16", "absent", "sick");
  await mark(k2, "2025-09-19", "present");
  await mark(k3, "2025-09-15", "present");
  await mark(k3, "2025-09-16", "present");
  const report = (child: string, from: string, to: string, reason: string, cancelled = false) =>
    c.query(`insert into absence_reports (kindergarten_id, child_id, date_from, date_to, reason, cancelled_at) values ($1, $2, $3, $4, $5, ${cancelled ? "now()" : "null"})`, [
      B,
      child,
      from,
      to,
      reason,
    ]);
  await report(k2, "2025-09-17", "2025-09-17", "vacation"); // no row → absent (vacation)
  await report(k3, "2025-09-17", "2025-09-17", "sick", true); // cancelled → not marked
  await report(k3, "2025-09-18", "2025-09-19", "sick"); // no rows → absent (sick) ×2

  // staff: the owner of B, Mon–Fri 09:00–18:00
  const u = F.users.ownerB;
  await c.query("delete from staff_schedules where kindergarten_id = $1 and user_id = $2", [B, u]);
  for (const wd of [1, 2, 3, 4, 5]) await c.query("insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time) values ($1, $2, $3, '09:00', '18:00')", [B, u, wd]);
  const session = (date: string, from: string, to: string, flags: { edited?: boolean; auto?: boolean } = {}) =>
    c.query("insert into work_sessions (kindergarten_id, user_id, work_date, started_at, ended_at, edited, auto_closed) values ($1, $2, $3, $4, $5, $6, $7)", [
      B,
      u,
      date,
      `${date}T${from}:00+05:00`,
      `${date}T${to}:00+05:00`,
      !!flags.edited,
      !!flags.auto,
    ]);
  await session("2025-09-15", "09:00", "18:00", { edited: true }); // on time, corrected
  await session("2025-09-16", "09:30", "18:00"); // late 30 min
  // 17.09 — nothing → not marked
  await c.query("insert into staff_absences (kindergarten_id, user_id, kind, date_from, date_to) values ($1, $2, 'sick', '2025-09-18', '2025-09-18')", [B, u]);
  await session("2025-09-19", "09:00", "13:00", { auto: true });
  await session("2025-09-20", "10:00", "12:00"); // Saturday — outside the schedule

  // finance: September and October 2025 for the only fee-paying child, 80 000 confirmed
  await c.query("select invoices_accrue($1, '2025-09-01'), invoices_accrue($1, '2025-10-01')", [B]);
  const inv = (await c.query("select id from invoices where child_id = $1 and period = '2025-10-01'", [k1])).rows[0].id;
  await c.query(
    "insert into payment_receipts (kindergarten_id, invoice_id, child_id, file_path, mime, size, status, confirmed_amount, reviewed_at) values ($1, $2, $3, $4, 'image/png', 100, 'accepted', 80000, '2025-10-05T10:00:00+05:00')",
    [B, inv, k1, `${B}/${k1}/analytics-test.png`],
  );

  // waitlist: 4 applications on 10.09.2025 — new / contacted / contacted → declined / accepted
  const app = async (name: string) =>
    (
      await c.query(
        "insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, created_at) values ($1, $2, '2022-01-01', 'Родитель Тестовый', '+77050000000', '2025-09-10T10:00:00+05:00') returning id",
        [B, name],
      )
    ).rows[0].id as string;
  await app("Заявка Новая");
  const a2 = await app("Заявка Связались");
  const a3 = await app("Заявка Отказ");
  const a4 = await app("Заявка Принята");
  await c.query("update waitlist_applications set status = 'contacted' where id = any($1)", [[a2, a3]]);
  await c.query("update waitlist_applications set status = 'declined' where id = $1", [a3]);
  await c.query("update waitlist_applications set status = 'accepted', child_id = $2, accepted_at = now() where id = $1", [a4, k2]);
  return { k1, k2, k3, g };
}

describe("analytics · numbers on a known dataset", () => {
  it("attendance: effective status (rows, parent reports, cancelled reports), working days only, occupancy", async () => {
    await inTx(async (c, become) => {
      await dataset(c);
      await become(F.users.ownerB);
      const r = (await c.query("select analytics_attendance($1, '2025-09-15', '2025-09-21') as r", [F.B])).rows[0].r;
      expect(r.days.map((d: { d: string }) => d.d)).toEqual(["2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18", "2025-09-19"]);
      const sum = (k: string) => r.days.reduce((s: number, d: Record<string, number>) => s + d[k], 0);
      expect({ present: sum("present"), absent: sum("absent"), sick: sum("sick"), unmarked: sum("unmarked"), enrolled: sum("enrolled") }).toEqual({
        present: 9,
        absent: 4,
        sick: 3,
        unmarked: 2,
        enrolled: 15,
      });
      expect(r.days[2]).toMatchObject({ present: 1, absent: 1, unmarked: 1 }); // Wednesday
      const grp = r.groups.find((x: { name: string }) => x.name === "Аналитика");
      expect(grp).toMatchObject({ capacity: 4, children: 3, present: 9, absent: 4, sick: 3, unmarked: 2 });
      expect(r.reasons).toEqual({ sick: 3, vacation: 1, family: 0, other: 0, none: 0 });
    });
  });

  it("staff: late, absent, not marked, worked vs planned, auto-closed and corrected days (worktime_range)", async () => {
    await inTx(async (c, become) => {
      await dataset(c);
      await become(F.users.ownerB);
      const rows = (await c.query("select * from analytics_staff($1, '2025-09-15', '2025-09-21')", [F.B])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: F.users.ownerB,
        scheduled_days: 5,
        worked_days: 4,
        late_days: 1,
        late_minutes: 30,
        absent_days: 1,
        sick_days: 1,
        unmarked_days: 1,
        outside_days: 1,
        planned_minutes: 5 * 540,
        worked_minutes: 540 + 510 + 240 + 120,
        auto_closed_days: 1,
        edited_days: 1,
      });
      // nothing before the first mark / joining
      expect((await c.query("select * from analytics_staff($1, '2025-09-01', '2025-09-12')", [F.B])).rows).toHaveLength(0);
    });
  });

  it("finance: charged / paid / debt per month with FIFO allocation, debtors with the oldest open due date", async () => {
    await inTx(async (c, become) => {
      const { k1 } = await dataset(c);
      await become(F.users.ownerB);
      const r = (await c.query("select analytics_finance($1, '2025-09-01', '2025-10-31') as r", [F.B])).rows[0].r;
      expect(r.months.map((m: Record<string, unknown>) => [m.period, Number(m.charged), Number(m.paid), Number(m.debt), m.paid_invoices])).toEqual([
        ["2025-09-01", 50000, 50000, 0, 1],
        ["2025-10-01", 50000, 30000, 20000, 0],
      ]);
      expect(Number(r.months[1].overdue)).toBe(20000);
      const d = r.debtors.find((x: { child_id: string }) => x.child_id === k1);
      expect(d).toMatchObject({ since: "2025-10-10", months: 1, group_name: "Аналитика" });
      expect(Number(d.debt)).toBe(20000);
      // a month without invoices is still listed (zeros), so the chart has a gap instead of a missing bar
      const nov = (await c.query("select analytics_finance($1, '2025-11-01', '2025-11-30') as r", [F.B])).rows[0].r;
      expect(nov.months).toEqual([{ period: "2025-11-01", invoices: 0, charged: 0, paid: 0, debt: 0, overdue: 0, paid_invoices: 0, avg_days: null }]);
    });
  });

  it("staff: the same days as worktime_range / the timesheet — expected only from joining the garden (D-017)", async () => {
    await inTx(async (c, become) => {
      await dataset(c);
      // the owner of B joined on 08.09.2025 (no marks before 15.09)
      await c.query("update memberships set created_at = '2025-09-08T09:00:00+05:00' where kindergarten_id = $1 and user_id = $2", [F.B, F.users.ownerB]);
      await become(F.users.ownerB);
      const a = (await c.query("select * from analytics_staff($1, '2025-09-01', '2025-09-12')", [F.B])).rows;
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ scheduled_days: 5, unmarked_days: 5, worked_days: 0 }); // 08–12.09, not 01–05.09
      const ts = (await c.query("select status from worktime_range($1, '2025-09-01', '2025-09-12') where user_id = $2", [F.B, F.users.ownerB])).rows;
      expect(ts.filter((r) => r.status === "unmarked")).toHaveLength(5);
    });
  });

  it("finance «as of» a date: only money accepted by then, FIFO, debt and overdue at that date", async () => {
    await inTx(async (c, become) => {
      const { k1 } = await dataset(c);
      const oct = (await c.query("select id from invoices where child_id = $1 and period = '2025-10-01'", [k1])).rows[0].id;
      await c.query(
        "insert into payment_receipts (kindergarten_id, invoice_id, child_id, file_path, mime, size, status, confirmed_amount, reviewed_at) values ($1, $2, $3, $4, 'image/png', 100, 'accepted', 20000, '2025-10-20T10:00:00+05:00')",
        [F.B, oct, k1, `${F.B}/${k1}/analytics-test-2.png`],
      );
      await become(F.users.ownerB);
      const at = async (from: string, to: string, until: string | null) =>
        (await c.query("select analytics_finance($1, $2, $3, $4) as r", [F.B, from, to, until])).rows[0].r;
      const row = (m: Record<string, unknown>) => [m.period, Number(m.charged), Number(m.paid), Number(m.debt), Number(m.overdue), m.paid_invoices];
      // today: everything paid
      expect((await at("2025-09-01", "2025-10-31", null)).months.map(row)).toEqual([
        ["2025-09-01", 50000, 50000, 0, 0, 1],
        ["2025-10-01", 50000, 50000, 0, 0, 1],
      ]);
      // September «as of 13.09» (the previous period on 13 October): nothing paid yet, overdue since the 10th
      const sep13 = await at("2025-09-01", "2025-09-13", "2025-09-13");
      expect(sep13.paid_until).toBe("2025-09-13");
      expect(sep13.months.map(row)).toEqual([["2025-09-01", 50000, 0, 50000, 50000, 0]]);
      // as of 10.10: the 80 000 receipt pays September in full and 30 000 of October (oldest first)
      const oct10 = await at("2025-09-01", "2025-10-31", "2025-10-10");
      expect(oct10.months.map(row)).toEqual([
        ["2025-09-01", 50000, 50000, 0, 0, 1],
        ["2025-10-01", 50000, 30000, 20000, 0, 0],
      ]);
      // the invoices were accrued today (paid_at = not before the invoice), so the delay is capped at the cut-off: 01.09 → 10.10
      expect(Number(oct10.months[0].avg_days)).toBe(39);
      // without a cut-off the same call equals the 3-argument one
      expect(await at("2025-09-01", "2025-10-31", null)).toEqual((await c.query("select analytics_finance($1, '2025-09-01', '2025-10-31') as r", [F.B])).rows[0].r);
    });
  });

  it("funnel: a child who left and came back counts once as left and once as joined; no guessed leave dates", async () => {
    await inTx(async (c, become) => {
      const { k2, k3 } = await dataset(c);
      // k3: archived 25.09.2025 (journal says «moved»), restored 06.10.2025 — the triggers write today's date, so the
      // history is moved back to the real days
      await c.query("update children set status = 'archived', archive_reason = 'moved', archived_at = '2025-09-25T12:00:00+05:00' where id = $1", [k3]);
      await c.query("update child_group_history set to_date = '2025-09-25' where child_id = $1", [k3]);
      await c.query("insert into audit_log (kindergarten_id, action, entity, entity_id, details, created_at) values ($1, 'child.archive', 'child', $2, '{\"reason\": \"moved\"}', '2025-09-25T12:00:00+05:00')", [F.B, k3]);
      await c.query("update children set status = 'active', archive_reason = null, archived_at = null where id = $1", [k3]);
      await c.query("update child_group_history set from_date = '2025-10-06' where child_id = $1 and to_date is null", [k3]);
      // k2: archived without archived_at (an old row) — its leave day is the day the history was closed (today), not the period end
      await c.query("update children set status = 'archived', archive_reason = 'family' where id = $1", [k2]);
      await become(F.users.ownerB);
      const sep = (await c.query("select analytics_funnel($1, '2025-09-01', '2025-09-30') as r", [F.B])).rows[0].r;
      expect({ j: sep.joined, l: sep.left, reasons: sep.left_reasons }).toEqual({ j: 3, l: 1, reasons: { moved: 1 } });
      expect(sep.active.find((x: { d: string }) => x.d === "2025-09-25").n).toBe(2);
      const oct = (await c.query("select analytics_funnel($1, '2025-10-01', '2025-10-31') as r", [F.B])).rows[0].r;
      expect({ j: oct.joined, l: oct.left }).toEqual({ j: 1, l: 0 });
      expect(oct.active.find((x: { d: string }) => x.d === "2025-10-05").n).toBe(2);
      expect(oct.active.find((x: { d: string }) => x.d === "2025-10-06").n).toBe(3);
    });
  });

  it("funnel: applications → contacted (timeline) → accepted; joined, left with reasons, active children per day", async () => {
    await inTx(async (c, become) => {
      const { k3 } = await dataset(c);
      await c.query("update children set status = 'archived', archive_reason = 'moved', archived_at = '2025-09-25T12:00:00+05:00' where id = $1", [k3]);
      await become(F.users.ownerB);
      const r = (await c.query("select analytics_funnel($1, '2025-09-01', '2025-09-30') as r", [F.B])).rows[0].r;
      expect({ a: r.applications, c: r.contacted, acc: r.accepted, d: r.declined, j: r.joined, l: r.left }).toEqual({ a: 4, c: 3, acc: 1, d: 1, j: 3, l: 1 });
      expect(r.left_reasons).toEqual({ moved: 1 });
      expect(r.active).toHaveLength(30);
      expect(r.active[0]).toEqual({ d: "2025-09-01", n: 3 });
      expect(r.active.find((x: { d: string }) => x.d === "2025-09-24").n).toBe(3);
      expect(r.active.find((x: { d: string }) => x.d === "2025-09-25").n).toBe(2);
      // the period before: nothing yet
      const before = (await c.query("select analytics_funnel($1, '2025-08-01', '2025-08-31') as r", [F.B])).rows[0].r;
      expect({ a: before.applications, j: before.joined, l: before.left, n: before.active[30].n }).toEqual({ a: 0, j: 0, l: 0, n: 0 });
    });
  });
});

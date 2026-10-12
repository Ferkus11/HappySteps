import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx } from "./fixtures";

// Findings of the stage 2 review (DECISIONS.md D-022).
let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

describe("stage 2 hardening", () => {
  it("cook and club teacher see no birthdays; staff birthdays never expose the year", async () => {
    const range = ["2000-01-01", "2000-12-31"].map((d) => d.replace("2000", String(new Date().getFullYear())));
    for (const who of ["cook", "clubTeacher"] as const) {
      await asUser(F.users[who], async (c) => {
        const r = await c.query("select * from calendar_birthdays($1, $2, $3)", [F.A, ...range]);
        expect(r.rowCount, who).toBe(0);
      });
    }
    await inTx(async (c, become) => {
      await c.query("update profiles set birth_date = '1990-06-15' where id = $1", [F.users.cook]);
      await become(F.users.head);
      const r = await c.query("select * from calendar_birthdays($1, $2, $3) where kind = 'staff'", [F.A, ...range]);
      expect(r.rowCount).toBeGreaterThan(0);
      expect(r.rows.every((x) => x.birth_date === null && x.age === null)).toBe(true);
    });
  });

  it("announcement files can't be registered by clients", async () => {
    await inTx(async (c, become) => {
      const a = await c.query(
        "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'all', 'x') returning id",
        [F.A, F.users.head],
      );
      await become(F.users.head);
      expect(
        await rejects(c, "insert into announcement_files (announcement_id, kindergarten_id, kind, path, name, mime, size) values ($1, $2, 'pdf', $3, 'a.pdf', 'application/pdf', 10)", [
          a.rows[0].id,
          F.A,
          `${F.B}/foreign/file.pdf`,
        ]),
      ).toBe(true);
      expect(await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title, created_at) values ($1, $2, 'all', 'x', now() + interval '1 year')", [F.A, F.users.head])).toBe(true);
    });
  });

  it("only owner/head create 'day off' events", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect(
        await rejects(c, "insert into events (kindergarten_id, author_id, audience, kind, title, date) values ($1, $2, 'groups', 'day_off', 'x', current_date + 1)", [F.A, F.users.teacher]),
      ).toBe(true);
      await become(F.users.head);
      await c.query("insert into events (kindergarten_id, author_id, audience, kind, title, date) values ($1, $2, 'all', 'day_off', 'x', current_date + 1)", [F.A, F.users.head]);
    });
  });

  it("attendance rows can't carry a client-chosen absence report", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect(
        await rejects(c, "insert into child_attendance (kindergarten_id, child_id, date, status, absence_report_id) values ($1, $2, kg_today($1), 'absent', gen_random_uuid())", [
          F.A,
          F.children["Алихан"],
        ]),
      ).toBe(true);
    });
  });

  it("helper functions don't answer about other gardens; club teacher gets no portions", async () => {
    await asUser(F.users.ownerB, async (c) => {
      const r = await c.query("select worktime_is_staff_member($1, $2) as m", [F.A, F.users.teacher]);
      expect(r.rows[0].m).toBe(false);
    });
    await asUser(F.users.clubTeacher, async (c) => {
      expect(await rejects(c, "select * from expected_portions($1, current_date)", [F.A])).toBe(true);
    });
    await asUser(null, async (c) => {
      expect(await rejects(c, "select child_group_on($1, current_date)", [F.children["Алихан"]])).toBe(true);
    });
  });
});

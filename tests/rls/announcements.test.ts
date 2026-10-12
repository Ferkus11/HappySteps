import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const seesIt = async (c: PoolClient, id: string) => (await c.query("select 1 from announcements where id = $1", [id])).rowCount === 1;

/** Creates an announcement as `who` (inside the current transaction) and returns its id. */
async function publish(c: PoolClient, become: (u: string | null) => Promise<void>, who: Who, audience: string, groups: string[] = [], kg?: string) {
  await become(F.users[who]);
  const r = await c.query("insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, $3, 'Тест') returning id", [
    kg ?? F.A,
    F.users[who],
    audience,
  ]);
  const id = r.rows[0].id as string;
  for (const g of groups) await c.query("insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, g, kg ?? F.A]);
  return id;
}

async function visibleTo(c: PoolClient, become: (u: string | null) => Promise<void>, id: string, who: Who[]) {
  const out: Partial<Record<Who, boolean>> = {};
  for (const w of who) {
    await become(F.users[w]);
    out[w] = await seesIt(c, id);
  }
  return out;
}

const ALL_A: Who[] = ["owner", "head", "accountant", "teacher", "clubTeacher", "cook", "parent", "teacherParent", "ownerB", "parentB"];

describe("announcements · audience", () => {
  it("whole garden: every member of A, nobody of B", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "head", "all");
      const v = await visibleTo(c, become, id, ALL_A);
      expect(v).toEqual({ owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: true, parent: true, teacherParent: true, ownerB: false, parentB: false });
    });
  });

  it("groups: admins + teachers of the groups + parents of children in them", async () => {
    await inTx(async (c, become) => {
      const sun = await publish(c, become, "head", "groups", [F.gA1]);
      expect(await visibleTo(c, become, sun, ALL_A)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: false, cook: false,
        parent: true, teacherParent: true /* parent of Миша in Солнышко */, ownerB: false, parentB: false,
      });
      const stars = await publish(c, become, "owner", "groups", [F.gA2]);
      expect(await visibleTo(c, become, stars, ALL_A)).toEqual({
        owner: true, head: true, accountant: true, teacher: false, clubTeacher: false, cook: false,
        parent: false /* child in another group */, teacherParent: true /* teacher of Звёздочки */, ownerB: false, parentB: false,
      });
      // child tables follow the announcement
      await become(F.users.parent);
      expect((await c.query("select 1 from announcement_groups where announcement_id = $1", [stars])).rowCount).toBe(0);
      expect((await c.query("select 1 from announcement_groups where announcement_id = $1", [sun])).rowCount).toBe(1);
    });
  });

  it("staff only: invisible to parents", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "owner", "staff");
      expect(await visibleTo(c, become, id, ALL_A)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: true, cook: true,
        parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
    });
  });

  it("parent stops seeing a group announcement when the child moves out of the group", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "head", "groups", [F.gA1]);
      await c.query("reset role");
      await c.query("update children set group_id = $1 where id = $2", [F.gA2, F.children["Алихан"]]);
      await become(F.users.parent);
      expect(await seesIt(c, id)).toBe(false);
    });
  });
});

describe("announcements · publishing rules", () => {
  it("teacher publishes only to own groups", async () => {
    await inTx(async (c, become) => {
      await become(F.users.teacher);
      expect(await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'all', 'x')", [F.A, F.users.teacher])).toBe(true);
      expect(await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'staff', 'x')", [F.A, F.users.teacher])).toBe(true);
      const id = (await c.query("insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'groups', 'x') returning id", [F.A, F.users.teacher])).rows[0].id;
      await c.query("insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, F.gA1, F.A]);
      expect(await rejects(c, "insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, F.gA2, F.A])).toBe(true);
      // cannot widen the audience afterwards
      expect(await rejects(c, "update announcements set audience = 'all' where id = $1", [id])).toBe(true);
      // the teacher-parent as teacher: Звёздочки yes, Солнышко no
      await become(F.users.teacherParent);
      const id2 = (await c.query("insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'groups', 'x') returning id", [F.A, F.users.teacherParent])).rows[0].id;
      await c.query("insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id2, F.gA2, F.A]);
      expect(await rejects(c, "insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id2, F.gA1, F.A])).toBe(true);
    });
  });

  it("parents, cook, accountant and club teacher cannot publish; nobody writes into another garden or as someone else", async () => {
    await inTx(async (c, become) => {
      for (const w of ["parent", "cook", "accountant", "clubTeacher"] as Who[]) {
        await become(F.users[w]);
        for (const aud of ["all", "groups", "staff"]) {
          expect(
            await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, $3, 'x')", [F.A, F.users[w], aud]),
            `${w} ${aud}`,
          ).toBe(true);
        }
      }
      await become(F.users.head);
      expect(await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'all', 'x')", [F.B, F.users.head])).toBe(true);
      expect(await rejects(c, "insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'all', 'x')", [F.A, F.users.owner])).toBe(true);
      const id = (await c.query("insert into announcements (kindergarten_id, author_id, audience, title) values ($1, $2, 'groups', 'x') returning id", [F.A, F.users.head])).rows[0].id;
      await c.query("reset role");
      const bGroup = (await c.query("select id from groups where kindergarten_id = $1 limit 1", [F.B])).rows[0].id;
      await become(F.users.head);
      expect(await rejects(c, "insert into announcement_groups (announcement_id, group_id, kindergarten_id) values ($1, $2, $3)", [id, bGroup, F.A])).toBe(true);
      expect(await rejects(c, "update announcements set author_id = $2 where id = $1", [id, F.users.owner])).toBe(true);
    });
  });

  it("edit/delete: author and owner/head only", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "teacher", "groups", [F.gA1]);
      await become(F.users.parent);
      expect((await c.query("update announcements set title = 'взлом' where id = $1", [id])).rowCount).toBe(0);
      expect((await c.query("delete from announcements where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.accountant);
      expect((await c.query("update announcements set title = 'взлом' where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.teacher);
      expect((await c.query("update announcements set title = 'Новое' where id = $1", [id])).rowCount).toBe(1);
      await become(F.users.head);
      expect((await c.query("update announcements set important = true where id = $1", [id])).rowCount).toBe(1);
      expect((await c.query("delete from announcements where id = $1", [id])).rowCount).toBe(1);
    });
  });
});

describe("announcements · reads, stats, reminders", () => {
  it("a user inserts only own read of a visible announcement and sees only own reads", async () => {
    await inTx(async (c, become) => {
      const vis = await publish(c, become, "head", "groups", [F.gA1]);
      const staff = await publish(c, become, "head", "staff");
      await become(F.users.parent);
      await c.query("insert into announcement_reads (announcement_id, user_id, kindergarten_id) values ($1, $2, $3)", [vis, F.users.parent, F.A]);
      expect(await rejects(c, "insert into announcement_reads (announcement_id, user_id, kindergarten_id) values ($1, $2, $3)", [vis, F.users.teacher, F.A])).toBe(true);
      expect(await rejects(c, "insert into announcement_reads (announcement_id, user_id, kindergarten_id) values ($1, $2, $3)", [staff, F.users.parent, F.A])).toBe(true);
      expect(await rejects(c, "delete from announcement_reads where announcement_id = $1", [vis])).toBe(true);
      await become(F.users.teacher);
      await c.query("insert into announcement_reads (announcement_id, user_id, kindergarten_id) values ($1, $2, $3)", [vis, F.users.teacher, F.A]);
      expect((await c.query("select user_id from announcement_reads where announcement_id = $1", [vis])).rows.map((r) => r.user_id)).toEqual([F.users.teacher]);
      // author / admin see all reads and the stats
      await become(F.users.head);
      expect((await c.query("select 1 from announcement_reads where announcement_id = $1", [vis])).rowCount).toBe(2);
      const aud = (await c.query("select user_id, read_at from announcement_audience($1)", [vis])).rows;
      const ids = aud.map((r) => r.user_id).sort();
      expect(ids).toEqual([F.users.owner, F.users.accountant, F.users.teacher, F.users.parent, F.users.teacherParent].sort());
      expect(aud.filter((r) => r.read_at).length).toBe(2);
      const st = (await c.query("select total, read from announcement_stats($1)", [[vis]])).rows[0];
      expect(st).toEqual({ total: 5, read: 2 });
      // a reader gets nothing from the stats functions
      await become(F.users.parent);
      expect((await c.query("select * from announcement_audience($1)", [vis])).rowCount).toBe(0);
      expect((await c.query("select * from announcement_stats($1)", [[vis]])).rowCount).toBe(0);
    });
  });

  it("reminder can be claimed once per hour, only by author/admin", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "teacher", "groups", [F.gA1]);
      await become(F.users.parent);
      expect(await rejects(c, "select claim_announcement_reminder($1)", [id])).toBe(true);
      await become(F.users.teacher);
      expect((await c.query("select claim_announcement_reminder($1) as ok", [id])).rows[0].ok).toBe(true);
      expect((await c.query("select claim_announcement_reminder($1) as ok", [id])).rows[0].ok).toBe(false);
      expect(await rejects(c, "update announcements set reminded_at = null where id = $1", [id])).toBe(true);
    });
  });
});

describe("announcements · files and storage", () => {
  it("file rows follow the announcement's visibility; only managers add them", async () => {
    await inTx(async (c, become) => {
      const id = await publish(c, become, "head", "staff");
      await c.query("insert into announcement_files (announcement_id, kindergarten_id, kind, path, name, mime, size) values ($1, $2, 'pdf', $3, 'a.pdf', 'application/pdf', 100)", [
        id,
        F.A,
        `${F.A}/announcements/${id}/x.pdf`,
      ]);
      await become(F.users.cook);
      expect((await c.query("select 1 from announcement_files where announcement_id = $1", [id])).rowCount).toBe(1);
      expect(await rejects(c, "insert into announcement_files (announcement_id, kindergarten_id, kind, path, name, mime, size) values ($1, $2, 'pdf', 'p2', 'b.pdf', 'application/pdf', 1)", [id, F.A])).toBe(true);
      await become(F.users.parent);
      expect((await c.query("select 1 from announcement_files where announcement_id = $1", [id])).rowCount).toBe(0);
      await become(F.users.ownerB);
      expect((await c.query("select 1 from announcement_files")).rowCount).toBe(0);
    });
  });

  it("the bucket is private and storage objects are not readable by anon or users", async () => {
    await asUser(null, async (c) => {
      const b = await c.query("select public from storage.buckets where id = 'announcements'");
      expect(b.rows.every((r) => r.public === false)).toBe(true);
      expect((await c.query("select 1 from storage.objects where bucket_id = 'announcements'")).rowCount).toBe(0);
      expect((await c.query("select 1 from announcements")).rowCount).toBe(0);
      expect((await c.query("select 1 from announcement_files")).rowCount).toBe(0);
      expect(await rejects(c, "select announcement_visible(gen_random_uuid())")).toBe(true);
    });
    await asUser(F.users.parent, async (c) => {
      expect((await c.query("select 1 from storage.objects where bucket_id = 'announcements'")).rowCount).toBe(0);
      expect(await rejects(c, "select audience_member($1, 'all', '{}', $2)", [F.A, F.users.head])).toBe(true);
    });
  });
});

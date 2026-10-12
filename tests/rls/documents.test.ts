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

/** Inserts a child document as superuser (like the server does with the service role). */
async function childDoc(c: PoolClient, kg: string, child: string, by: string, category = "medical") {
  const id = randomUUID();
  await c.query(
    "insert into child_documents (id, kindergarten_id, child_id, category, title, path, mime, size, uploaded_by) values ($1, $2, $3, $4, 'Справка', $5, 'application/pdf', 100, $6)",
    [id, kg, child, category, `${kg}/${child}/${randomUUID()}.pdf`, by],
  );
  return id;
}

async function staffDoc(c: PoolClient, kg: string, user: string, by: string, expires: string | null = null) {
  const id = randomUUID();
  await c.query(
    "insert into staff_documents (id, kindergarten_id, user_id, type, title, expires_on, path, mime, size, uploaded_by) values ($1, $2, $3, 'med_book', 'Медкнижка', $4, $5, 'image/jpeg', 100, $6)",
    [id, kg, user, expires, `${kg}/${user}/${randomUUID()}.jpg`, by],
  );
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

describe("documents · child folders (§3.4)", () => {
  it("Алихан (Солнышко): owner, head, his parent and the Солнышко teacher; nobody else", async () => {
    await inTx(async (c, become) => {
      const id = await childDoc(c, F.A, F.children["Алихан"], F.users.parent);
      expect(await visibility(c, become, "child_documents", id)).toEqual({
        owner: true, head: true, accountant: false, teacher: true, clubTeacher: false, cook: false,
        parent: true, teacherParent: false /* parent of Миша, teacher of Звёздочки */, ownerB: false, parentB: false,
      });
    });
  });

  it("Сабина (Звёздочки): the Звёздочки teacher sees it, the Солнышко teacher does not", async () => {
    await inTx(async (c, become) => {
      const id = await childDoc(c, F.A, F.children["Сабина"], F.users.head, "vaccination");
      expect(await visibility(c, become, "child_documents", id)).toEqual({
        owner: true, head: true, accountant: false, teacher: false, clubTeacher: false, cook: false,
        parent: false, teacherParent: true, ownerB: false, parentB: false,
      });
    });
  });

  it("garden B document is invisible to garden A, visible to its owner and parent", async () => {
    await inTx(async (c, become) => {
      const id = await childDoc(c, F.B, F.children["Саша"], F.users.parentB);
      const v = await visibility(c, become, "child_documents", id);
      expect(v.ownerB && v.parentB).toBe(true);
      expect(Object.entries(v).filter(([k, x]) => x && !["ownerB", "parentB"].includes(k))).toEqual([]);
    });
  });

  it("follows the child: a teacher loses access when the child moves to another group", async () => {
    await inTx(async (c, become) => {
      const id = await childDoc(c, F.A, F.children["Алихан"], F.users.parent);
      await c.query("update children set group_id = $1 where id = $2", [F.gA2, F.children["Алихан"]]);
      await become(F.users.teacher);
      expect((await c.query("select 1 from child_documents where id = $1", [id])).rowCount).toBe(0);
      await become(F.users.teacherParent);
      expect((await c.query("select 1 from child_documents where id = $1", [id])).rowCount).toBe(1);
    });
  });

  it("no client inserts or updates — not even owner/head or the parent", async () => {
    const alikhan = F.children["Алихан"];
    for (const who of ["owner", "head", "parent", "teacher"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        expect(
          await rejects(
            c,
            "insert into child_documents (kindergarten_id, child_id, category, title, path, mime, size, uploaded_by) values ($1, $2, 'medical', 'x', $3, 'application/pdf', 1, $4)",
            [F.A, alikhan, `${F.A}/${alikhan}/${randomUUID()}.pdf`, F.users[who]],
          ),
          who,
        ).toBe(true);
        expect(await rejects(c, "update child_documents set title = 'x' where child_id = $1", [alikhan]), who).toBe(true);
      });
    }
  });

  it("delete: a parent only own uploads, the teacher nothing, owner/head anything", async () => {
    await inTx(async (c, become) => {
      const byParent = await childDoc(c, F.A, F.children["Алихан"], F.users.parent);
      const byHead = await childDoc(c, F.A, F.children["Алихан"], F.users.head);
      await become(F.users.teacher);
      expect((await c.query("delete from child_documents where id in ($1, $2)", [byParent, byHead])).rowCount).toBe(0);
      await become(F.users.teacherParent);
      expect((await c.query("delete from child_documents where id in ($1, $2)", [byParent, byHead])).rowCount).toBe(0);
      await become(F.users.parent);
      expect((await c.query("delete from child_documents where id = $1", [byHead])).rowCount).toBe(0);
      expect((await c.query("delete from child_documents where id = $1", [byParent])).rowCount).toBe(1);
      await become(F.users.ownerB);
      expect((await c.query("delete from child_documents where id = $1", [byHead])).rowCount).toBe(0);
      await become(F.users.head);
      expect((await c.query("delete from child_documents where id = $1", [byHead])).rowCount).toBe(1);
    });
  });

  it("upload helpers: parents and owner/head yes; teacher, accountant, cook, other parents no", async () => {
    const a = F.children["Алихан"];
    const expected: Partial<Record<Who, boolean>> = {
      owner: true, head: true, parent: true, teacher: false, accountant: false, cook: false, clubTeacher: false, teacherParent: false, ownerB: false, parentB: false,
    };
    for (const [who, can] of Object.entries(expected)) {
      await asUser(F.users[who as Who], async (c) => {
        expect((await c.query("select child_docs_can_upload($1) as v", [a])).rows[0].v, who).toBe(can);
      });
    }
    await asUser(null, async (c) => {
      expect(await rejects(c, "select child_docs_can_view($1)", [a])).toBe(true);
    });
  });
});

describe("documents · storage paths", () => {
  it("path must be <garden>/<child|user>/<uuid>.<jpg|png|webp|pdf> of the row itself", async () => {
    await inTx(async (c) => {
      const a = F.children["Алихан"];
      const m = F.children["Миша"];
      const ins = (path: string, child = a, kg = F.A) =>
        rejects(c, "insert into child_documents (kindergarten_id, child_id, category, title, path, mime, size) values ($1, $2, 'other', 'x', $3, 'application/pdf', 1)", [kg, child, path]);
      expect(await ins(`${F.A}/${m}/${randomUUID()}.pdf`)).toBe(true); // another child's folder
      expect(await ins(`${F.B}/${a}/${randomUUID()}.pdf`)).toBe(true); // another garden's prefix
      expect(await ins(`${F.A}/${a}/../${m}/${randomUUID()}.pdf`)).toBe(true);
      expect(await ins(`${F.A}/${a}/${randomUUID()}.html`)).toBe(true);
      expect(await ins(`${F.A}/${a}/${randomUUID()}.pdf`, F.children["Саша"], F.B)).toBe(true); // B child, A path
      expect(await ins(`${F.B}/${a}/${randomUUID()}.pdf`, a, F.B)).toBe(true); // A child in a B row (trigger)
      expect(await ins(`${F.A}/${a}/${randomUUID()}.pdf`)).toBe(false);
      const sins = (path: string, user: string, kg = F.A) =>
        rejects(c, "insert into staff_documents (kindergarten_id, user_id, type, title, path, mime, size) values ($1, $2, 'other', 'x', $3, 'image/png', 1)", [kg, user, path]);
      expect(await sins(`${F.A}/${F.users.cook}/${randomUUID()}.png`, F.users.teacher)).toBe(true);
      expect(await sins(`${F.A}/${F.users.parent}/${randomUUID()}.png`, F.users.parent)).toBe(true); // parents have no staff documents
      expect(await sins(`${F.A}/${F.users.ownerB}/${randomUUID()}.png`, F.users.ownerB)).toBe(true); // not staff of A
      expect(await sins(`${F.A}/${F.users.cook}/${randomUUID()}.png`, F.users.cook)).toBe(false);
      // mime and size limits
      expect(
        await rejects(c, "insert into staff_documents (kindergarten_id, user_id, type, title, path, mime, size) values ($1, $2, 'other', 'x', $3, 'text/html', 1)", [
          F.A, F.users.cook, `${F.A}/${F.users.cook}/${randomUUID()}.png`,
        ]),
      ).toBe(true);
      expect(
        await rejects(c, "insert into staff_documents (kindergarten_id, user_id, type, title, path, mime, size) values ($1, $2, 'other', 'x', $3, 'image/png', $4)", [
          F.A, F.users.cook, `${F.A}/${F.users.cook}/${randomUUID()}.png`, 15 * 1024 * 1024 + 1,
        ]),
      ).toBe(true);
    });
  });
});

describe("documents · staff documents (§3.4)", () => {
  it("teacher's document: owner, head, accountant and the teacher", async () => {
    await inTx(async (c, become) => {
      const id = await staffDoc(c, F.A, F.users.teacher, F.users.head, "2027-01-01");
      expect(await visibility(c, become, "staff_documents", id)).toEqual({
        owner: true, head: true, accountant: true, teacher: true, clubTeacher: false, cook: false,
        parent: false, teacherParent: false, ownerB: false, parentB: false,
      });
    });
  });

  it("cook and club teacher see only their own", async () => {
    await inTx(async (c, become) => {
      const cook = await staffDoc(c, F.A, F.users.cook, F.users.cook);
      const club = await staffDoc(c, F.A, F.users.clubTeacher, F.users.clubTeacher);
      await become(F.users.cook);
      expect((await c.query("select id from staff_documents where id in ($1, $2)", [cook, club])).rows.map((r) => r.id)).toEqual([cook]);
      await become(F.users.clubTeacher);
      expect((await c.query("select id from staff_documents where id in ($1, $2)", [cook, club])).rows.map((r) => r.id)).toEqual([club]);
      await become(F.users.parent);
      expect((await c.query("select count(*)::int as n from staff_documents")).rows[0].n).toBe(0);
    });
  });

  it("archived employee no longer sees own documents", async () => {
    await inTx(async (c, become) => {
      const id = await staffDoc(c, F.A, F.users.cook, F.users.cook);
      await c.query("update memberships set status = 'archived' where user_id = $1 and kindergarten_id = $2", [F.users.cook, F.A]);
      await become(F.users.cook);
      expect((await c.query("select 1 from staff_documents where id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("no client inserts or updates", async () => {
    for (const who of ["owner", "head", "teacher", "cook", "accountant"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        expect(
          await rejects(
            c,
            "insert into staff_documents (kindergarten_id, user_id, type, title, path, mime, size, uploaded_by) values ($1, $2, 'other', 'x', $3, 'application/pdf', 1, $2)",
            [F.A, F.users[who], `${F.A}/${F.users[who]}/${randomUUID()}.pdf`],
          ),
          who,
        ).toBe(true);
        expect(await rejects(c, "update staff_documents set expires_on = '2099-01-01' where user_id = $1", [F.users[who]]), who).toBe(true);
      });
    }
  });

  it("delete: the employee only own uploads; accountant nothing; owner/head anything", async () => {
    await inTx(async (c, become) => {
      const own = await staffDoc(c, F.A, F.users.teacher, F.users.teacher);
      const byHead = await staffDoc(c, F.A, F.users.teacher, F.users.head);
      const cooks = await staffDoc(c, F.A, F.users.cook, F.users.cook);
      await become(F.users.accountant);
      expect((await c.query("delete from staff_documents where id in ($1, $2, $3)", [own, byHead, cooks])).rowCount).toBe(0);
      await become(F.users.teacher);
      expect((await c.query("delete from staff_documents where id in ($1, $2)", [byHead, cooks])).rowCount).toBe(0);
      expect((await c.query("delete from staff_documents where id = $1", [own])).rowCount).toBe(1);
      await become(F.users.head);
      expect((await c.query("delete from staff_documents where id in ($1, $2)", [byHead, cooks])).rowCount).toBe(2);
    });
  });

  it("upload helper: self (staff) or owner/head, target must be active staff", async () => {
    const can = async (who: Who, target: Who) =>
      asUser(F.users[who], async (c) => (await c.query("select staff_docs_can_upload($1, $2) as v", [F.A, F.users[target]])).rows[0].v as boolean);
    expect(await can("teacher", "teacher")).toBe(true);
    expect(await can("cook", "cook")).toBe(true);
    expect(await can("teacher", "cook")).toBe(false);
    expect(await can("accountant", "teacher")).toBe(false);
    expect(await can("head", "teacher")).toBe(true);
    expect(await can("owner", "accountant")).toBe(true);
    expect(await can("head", "parent")).toBe(false); // parents have no staff documents
    expect(await can("parent", "parent")).toBe(false);
    expect(await can("ownerB", "teacher")).toBe(false);
  });
});

describe("documents · expiry reminders selection", () => {
  it("document_expiry_due is for the service role only", async () => {
    for (const who of ["owner", "head", "teacher"] as Who[]) {
      await asUser(F.users[who], async (c) => {
        expect(await rejects(c, "select * from document_expiry_due()"), who).toBe(true);
      });
    }
    await asUser(null, async (c) => {
      expect(await rejects(c, "select * from document_expiry_due()")).toBe(true);
    });
    await inTx(async (c) => {
      await c.query("set local role service_role");
      await c.query("select * from document_expiry_due()");
    });
  });

  it("30 days → threshold 30, 7 days → threshold 7, once per document and expiry date", async () => {
    await inTx(async (c) => {
      const today = (await c.query("select kg_today($1)::text as d", [F.A])).rows[0].d as string;
      const at = async (days: number) => (await c.query("select ($1::date + $2::int)::text as d", [today, days])).rows[0].d as string;
      const docs: Record<string, number> = {};
      for (const d of [40, 31, 30, 20, 8, 7, 3, 0, -1]) docs[await staffDoc(c, F.A, F.users.cook, F.users.head, await at(d))] = d;
      const noExpiry = await staffDoc(c, F.A, F.users.cook, F.users.head, null);
      const due = async () => {
        const r = await c.query("select document_id, threshold, days_left, person, user_id from document_expiry_due()");
        return Object.fromEntries(r.rows.filter((x) => x.document_id in docs || x.document_id === noExpiry).map((x) => [docs[x.document_id], x.threshold]));
      };
      expect(await due()).toEqual({ 30: 30, 20: 30, 8: 30, 7: 7, 3: 7, 0: 7 });
      // sent once → not selected again; a new expiry date re-arms it
      const twenty = Object.keys(docs).find((k) => docs[k] === 20)!;
      const exp = await at(20);
      await c.query("insert into staff_document_reminders (document_id, kindergarten_id, expires_on, threshold) values ($1, $2, $3, 30)", [twenty, F.A, exp]);
      expect((await due())[20]).toBeUndefined();
      await c.query("update staff_documents set expires_on = $1 where id = $2", [await at(5), twenty]);
      const r = await c.query("select threshold from document_expiry_due() where document_id = $1", [twenty]);
      expect(r.rows.map((x) => x.threshold)).toEqual([7]);
      // an archived employee gets no reminders
      await c.query("update memberships set status = 'archived' where user_id = $1 and kindergarten_id = $2", [F.users.cook, F.A]);
      expect(await due()).toEqual({});
    });
  });

  it("a renewed document of the same type retires the old copy from reminders and the expiring list", async () => {
    await inTx(async (c, become) => {
      const today = (await c.query("select kg_today($1)::text as d", [F.A])).rows[0].d as string;
      const old = await staffDoc(c, F.A, F.users.cook, F.users.head, today);
      await c.query("update staff_documents set created_at = now() - interval '1 year' where id = $1", [old]);
      const ids = async () => (await c.query("select document_id from document_expiry_due() where user_id = $1", [F.users.cook])).rows.map((r) => r.document_id);
      expect(await ids()).toContain(old);
      // an "other" document does not replace a med book
      await c.query(
        "insert into staff_documents (kindergarten_id, user_id, type, title, expires_on, path, mime, size) values ($1, $2, 'other', 'Справка', null, $3, 'image/jpeg', 100)",
        [F.A, F.users.cook, `${F.A}/${F.users.cook}/${randomUUID()}.jpg`],
      );
      expect(await ids()).toContain(old);
      const renewed = await staffDoc(c, F.A, F.users.cook, F.users.head, "2099-01-01");
      expect(await ids()).not.toContain(old);
      // the computed column is what the dashboard filters on, under the viewer's RLS
      await become(F.users.head);
      const r = await c.query("select id, superseded(d) as s from staff_documents d where id = any($1)", [[old, renewed]]);
      expect(Object.fromEntries(r.rows.map((x) => [x.id, x.s]))).toEqual({ [old]: true, [renewed]: false });
    });
  });

  it("reminder bookkeeping is service-role only", async () => {
    await inTx(async (c, become) => {
      const id = await staffDoc(c, F.A, F.users.teacher, F.users.head, "2030-01-01");
      await c.query("insert into staff_document_reminders (document_id, kindergarten_id, expires_on, threshold) values ($1, $2, '2030-01-01', 30)", [id, F.A]);
      for (const who of ["owner", "head", "teacher"] as Who[]) {
        await become(F.users[who]);
        expect((await c.query("select count(*)::int as n from staff_document_reminders")).rows[0].n, who).toBe(0);
        expect(await rejects(c, "insert into staff_document_reminders (document_id, kindergarten_id, expires_on, threshold) values ($1, $2, '2030-01-01', 7)", [id, F.A]), who).toBe(true);
      }
      await c.query("reset role");
      // bookkeeping row must belong to the document's garden
      expect(await rejects(c, "insert into staff_document_reminders (document_id, kindergarten_id, expires_on, threshold) values ($1, $2, '2030-01-01', 7)", [id, F.B])).toBe(true);
    });
  });
});

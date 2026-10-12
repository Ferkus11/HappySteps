import { admin } from "./db";

export const PHONES = {
  superadmin: "+77000000001",
  owner: "+77010000001",
  head: "+77010000002",
  accountant: "+77010000003",
  teacher: "+77010000004",
  clubTeacher: "+77010000005",
  cook: "+77010000006",
  parent: "+77010000007",
  teacherParent: "+77010000008",
  ownerB: "+77020000001",
  parentB: "+77020000002",
} as const;

export type Who = keyof typeof PHONES;

let cache: { users: Record<Who, string>; A: string; B: string; gA1: string; gA2: string; children: Record<string, string> } | null = null;

/** Ids of the e2e fixtures (run `npm run db:seed -- --e2e` first). */
export async function fx() {
  if (cache) return cache;
  return admin(async (c) => {
    const users = {} as Record<Who, string>;
    for (const [k, phone] of Object.entries(PHONES)) {
      const r = await c.query("select id from profiles where phone = $1", [phone]);
      if (!r.rows[0]) throw new Error(`fixture ${k} missing — run npm run db:seed -- --e2e`);
      users[k as Who] = r.rows[0].id;
    }
    const kg = await c.query("select id, slug from kindergartens where slug in ('e2e-a','e2e-b')");
    const A = kg.rows.find((r) => r.slug === "e2e-a").id;
    const B = kg.rows.find((r) => r.slug === "e2e-b").id;
    const g = await c.query("select id, name from groups where kindergarten_id = $1", [A]);
    const ch = await c.query("select id, full_name from children where kindergarten_id in ($1, $2)", [A, B]);
    cache = {
      users,
      A,
      B,
      gA1: g.rows.find((r) => r.name === "Солнышко").id,
      gA2: g.rows.find((r) => r.name === "Звёздочки").id,
      children: Object.fromEntries(ch.rows.map((r) => [r.full_name.split(" ")[1], r.id])),
    };
    return cache;
  });
}

/** All public tables that carry kindergarten_id (new modules are covered automatically). */
export async function tenantTables(): Promise<string[]> {
  return admin(async (c) => {
    const r = await c.query(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'kindergarten_id'
         and table_name in (select tablename from pg_tables where schemaname = 'public')
       order by 1`,
    );
    return r.rows.map((x) => x.table_name as string);
  });
}

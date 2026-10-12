import { describe, expect, it } from "vitest";
import { admin } from "./db";

describe("RLS coverage", () => {
  it("every table in public has row level security enabled", async () => {
    const { rows } = await admin((c) =>
      c.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
      ),
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("supabase roles exist", async () => {
    const { rows } = await admin((c) =>
      c.query<{ rolname: string }>(`select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`),
    );
    expect(rows.map((r) => r.rolname)).toEqual(["anon", "authenticated", "service_role"]);
  });
});

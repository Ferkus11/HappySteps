import { Pool, type PoolClient } from "pg";

export const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/happysteps",
  max: 4,
});

export type Claims = { sub: string; role?: string };

/**
 * Runs `fn` inside a transaction as the given user, exactly like PostgREST does:
 * `set local role authenticated` + `request.jwt.claims`. Always rolled back.
 */
export async function asUser<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (userId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
    } else {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await client.query("set local role anon");
    }
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** Superuser access for fixtures. Changes are committed. */
export async function admin<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Expects the statement to be rejected (RLS violation or permission error). */
export async function rejects(c: PoolClient, sql: string, params: unknown[] = []): Promise<boolean> {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    await c.query("release savepoint s");
    return false;
  } catch {
    await c.query("rollback to savepoint s");
    return true;
  }
}

/** Transaction (rolled back) where setup runs as superuser, then `become` switches to a user. */
export async function inTx<T>(fn: (c: PoolClient, become: (userId: string | null) => Promise<void>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const become = async (userId: string | null) => {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
      ]);
      await client.query(userId ? "set local role authenticated" : "set local role anon");
    };
    return await fn(client, become);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

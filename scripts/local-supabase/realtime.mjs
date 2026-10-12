// Minimal Supabase Realtime emulation for the local stack (dev/CI only).
//
// Supports what the app uses: `postgres_changes` subscriptions (INSERT/UPDATE/DELETE, filters
// eq/neq/lt/lte/gt/gte/in) over the Phoenix protocol (vsn 1.0.0 and 2.0.0 JSON frames), heartbeats
// and token refresh. Changes come from row triggers on every table in the `supabase_realtime`
// publication (installed by `realtime_local.sync()`, see bootstrap.sql), which NOTIFY the primary key.
// Each subscriber re-reads the row *as itself* (role + JWT claims), so RLS decides who receives what —
// the same guarantee real Supabase Realtime gives. Like Supabase, DELETE events carry only the key.
import { WebSocketServer } from "ws";
import pg from "pg";
import { jwtVerify } from "jose";

const ROLES = new Set(["anon", "authenticated", "service_role"]);

export function attachRealtime(server, { secret, dbUrl }) {
  if (!dbUrl) return;
  const pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const wss = new WebSocketServer({ noServer: true });
  /** @type {Set<Client>} */
  const clients = new Set();
  let nextId = 1;
  const pkCache = new Map();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/realtime/v1/websocket") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = new Client(ws, url.searchParams.get("apikey"));
      clients.add(client);
      ws.on("close", () => clients.delete(client));
    });
  });

  async function verify(token) {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secret);
      return ROLES.has(payload.role) ? payload : null;
    } catch {
      return null;
    }
  }

  class Client {
    constructor(ws, apikey) {
      this.ws = ws;
      this.apikey = apikey;
      /** topic → { joinRef, claims, bindings: [{id, event, schema, table, filter}] } */
      this.channels = new Map();
      ws.on("message", (raw, isBinary) => {
        if (isBinary) return; // binary broadcast frames are not emulated
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const frame = Array.isArray(msg)
          ? { join_ref: msg[0], ref: msg[1], topic: msg[2], event: msg[3], payload: msg[4], v2: true }
          : { ...msg, v2: false };
        this.handle(frame).catch((e) => console.error("realtime:", e.message));
      });
    }

    send(f, v2 = true) {
      if (this.ws.readyState !== 1) return;
      const body = v2 ? [f.join_ref ?? null, f.ref ?? null, f.topic, f.event, f.payload] : f;
      this.ws.send(JSON.stringify(body));
    }

    reply(f, status, response = {}) {
      this.send({ join_ref: f.join_ref, ref: f.ref, topic: f.topic, event: "phx_reply", payload: { status, response } }, f.v2);
    }

    async handle(f) {
      this.v2 = f.v2;
      if (f.topic === "phoenix" && f.event === "heartbeat") return this.reply(f, "ok");
      if (f.event === "phx_join") {
        const cfg = f.payload?.config ?? {};
        const claims = (await verify(f.payload?.access_token)) ?? (await verify(this.apikey));
        if (!claims) return this.reply(f, "error", { reason: "invalid token" });
        const bindings = (cfg.postgres_changes ?? []).map((b) => ({
          id: nextId++,
          event: b.event ?? "*",
          schema: b.schema ?? "public",
          table: b.table,
          filter: b.filter,
        }));
        this.channels.set(f.topic, { joinRef: f.join_ref, claims, bindings });
        this.reply(f, "ok", { postgres_changes: bindings });
        if (bindings.length) {
          this.send(
            {
              join_ref: f.join_ref,
              ref: null,
              topic: f.topic,
              event: "system",
              payload: { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes", channel: f.topic.replace(/^realtime:/, "") },
            },
            f.v2,
          );
        }
        return;
      }
      if (f.event === "access_token") {
        const ch = this.channels.get(f.topic);
        const claims = await verify(f.payload?.access_token);
        if (ch && claims) ch.claims = claims;
        return this.reply(f, "ok");
      }
      if (f.event === "phx_leave") {
        this.channels.delete(f.topic);
        this.reply(f, "ok");
        return this.send({ join_ref: f.join_ref, ref: f.ref, topic: f.topic, event: "phx_close", payload: {} }, f.v2);
      }
      // broadcast / presence are not emulated; acknowledge so the client doesn't time out.
      if (f.ref) this.reply(f, "ok");
    }
  }

  async function primaryKey(schema, table) {
    const key = `${schema}.${table}`;
    if (!pkCache.has(key)) {
      const { rows } = await pool.query(
        `select a.attname from pg_index i
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
          where i.indrelid = format('%I.%I', $1::text, $2::text)::regclass and i.indisprimary`,
        [schema, table],
      );
      pkCache.set(key, rows.map((r) => r.attname));
    }
    return pkCache.get(key);
  }

  /** Reads the row (current state) as the subscriber; null when RLS hides it. */
  async function readAs(claims, schema, table, pk) {
    const cols = await primaryKey(schema, table);
    if (!cols.length) return null;
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await c.query(`set local role ${claims.role}`);
      const where = cols.map((col, i) => `t.${pg.escapeIdentifier(col)}::text = $${i + 1}`).join(" and ");
      const { rows } = await c.query(
        `select to_jsonb(t) as row from ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)} t where ${where}`,
        cols.map((col) => (pk[col] == null ? null : String(pk[col]))),
      );
      return rows[0]?.row ?? null;
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  function matches(filter, row) {
    if (!filter) return true;
    const m = /^([^=]+)=(eq|neq|lt|lte|gt|gte|in)\.(.*)$/.exec(filter);
    if (!m || !row) return false;
    const [, col, op, raw] = m;
    const v = row[col] == null ? null : String(row[col]);
    if (op === "in") return raw.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).includes(v);
    if (op === "eq") return v === raw;
    if (op === "neq") return v !== raw;
    const a = Number(v);
    const b = Number(raw);
    const [x, y] = Number.isNaN(a) || Number.isNaN(b) ? [v ?? "", raw] : [a, b];
    return op === "lt" ? x < y : op === "lte" ? x <= y : op === "gt" ? x > y : x >= y;
  }

  async function dispatch(change) {
    const { schema, table, type, pk, commit_timestamp } = change;
    const cache = new Map(); // visibility per subscriber identity
    for (const client of clients) {
      for (const [topic, ch] of client.channels) {
        const hits = ch.bindings.filter(
          (b) => (b.schema === "*" || b.schema === schema) && (!b.table || b.table === "*" || b.table === table) && (b.event === "*" || b.event === type),
        );
        if (!hits.length) continue;
        let record = null;
        if (type !== "DELETE") {
          // RLS check as the subscriber; the payload is the row as of the change when available.
          const who = `${ch.claims.role}:${ch.claims.sub ?? ""}`;
          if (!cache.has(who)) cache.set(who, await readAs(ch.claims, schema, table, pk).catch(() => null));
          const visible = cache.get(who);
          if (!visible) continue;
          record = change.record ?? visible;
        }
        const ids = hits.filter((b) => type === "DELETE" || matches(b.filter, record)).map((b) => b.id);
        if (!ids.length) continue;
        client.send(
          {
            join_ref: null,
            ref: null,
            topic,
            event: "postgres_changes",
            payload: {
              ids,
              data: {
                schema,
                table,
                commit_timestamp,
                type,
                columns: [],
                record: type === "DELETE" ? {} : record,
                old_record: type === "INSERT" ? {} : pk,
                errors: null,
              },
            },
          },
          client.v2 !== false,
        );
      }
    }
  }

  let queue = Promise.resolve();
  // Dedicated LISTEN connection with reconnect.
  const listen = async () => {
    const c = new pg.Client({ connectionString: dbUrl });
    c.on("error", () => {});
    c.on("end", () => setTimeout(listen, 1000));
    c.on("notification", (n) => {
      let change;
      try {
        change = JSON.parse(n.payload);
      } catch {
        return;
      }
      // Deliver strictly in commit order.
      queue = queue.then(() => dispatch(change)).catch((e) => console.error("realtime dispatch:", e.message));
    });
    try {
      await c.connect();
      await c.query("listen hs_realtime");
    } catch {
      setTimeout(listen, 1000);
    }
  };
  listen();
}

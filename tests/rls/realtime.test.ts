import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin } from "./db";
import { fx, PHONES } from "./fixtures";

// Guards the local Realtime emulation (scripts/local-supabase/realtime.mjs): delivery respects RLS.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const domain = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
let F: Awaited<ReturnType<typeof fx>>;
const clients: SupabaseClient[] = [];

beforeAll(async () => {
  F = await fx();
  await admin(async (c) => {
    await c.query(`drop table if exists public.zz_rt_probe`);
    await c.query(`create table public.zz_rt_probe (id uuid primary key default gen_random_uuid(), kindergarten_id uuid not null, body text)`);
    await c.query(`alter table public.zz_rt_probe enable row level security`);
    await c.query(`create policy p on public.zz_rt_probe for select to authenticated using (public.is_member(kindergarten_id))`);
    await c.query(`alter publication supabase_realtime add table public.zz_rt_probe`);
    await c.query(`select realtime_local.sync()`);
  });
});

afterAll(async () => {
  for (const c of clients) await c.removeAllChannels();
  await admin((c) => c.query(`drop table if exists public.zz_rt_probe`));
});

async function subscribe(phone: string, filter?: string) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(c);
  const { error } = await c.auth.signInWithPassword({ email: `${phone.replace(/\D/g, "")}@${domain}`, password: "Test1234!" });
  if (error) throw error;
  const got: string[] = [];
  await new Promise<void>((resolve, reject) =>
    c
      .channel(`probe-${phone}-${filter ?? ""}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "zz_rt_probe", ...(filter ? { filter } : {}) }, (p) =>
        got.push(`${p.eventType}:${(p.new as { body?: string }).body ?? ""}`),
      )
      .subscribe((s, e) => (s === "SUBSCRIBED" ? resolve() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? reject(e ?? new Error(s)) : undefined)),
  );
  return got;
}

describe("local realtime emulation", () => {
  it("delivers inserts/updates only to users allowed by RLS, honouring filters and order", async () => {
    const ownerA = await subscribe(PHONES.owner);
    const ownerB = await subscribe(PHONES.ownerB);
    const headFiltered = await subscribe(PHONES.head, "body=eq.hello");
    await admin(async (c) => {
      await c.query("insert into zz_rt_probe (kindergarten_id, body) values ($1, 'hello'), ($1, 'other')", [F.A]);
      await c.query("update zz_rt_probe set body = 'changed' where body = 'other'");
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(ownerA).toEqual(["INSERT:hello", "INSERT:other", "UPDATE:changed"]);
    expect(ownerB).toEqual([]);
    expect(headFiltered).toEqual(["INSERT:hello"]);
  });
});

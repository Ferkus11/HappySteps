/**
 * Helpers for the «Happy Steps» demo dataset (scripts/seed/demo.ts): deterministic randomness, local dates of the
 * garden (Asia/Almaty, UTC+5 all year), bulk writes through the service client and storage uploads.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEMO_SLUG = "happy-steps";
export const DEMO_NAME = "Happy Steps";
export const TZ = "Asia/Almaty";
/** Almaty has no daylight saving time: local wall time is always UTC+5. */
export const OFFSET = "+05:00";

/**
 * Demo phone range: every demo account is +7 707 0xx xx xx. E2E fixtures use +7 700/701/702 and random +7 705 numbers,
 * so the demo never touches them (and the cleanup deletes only this range).
 */
export const DEMO_PHONE_PREFIX = "+77070";
export const DEMO_EMAIL_PREFIX = DEMO_PHONE_PREFIX.slice(1); // auth e-mails are the phone digits (D-004)

export const uuid = () => randomUUID();

// ───────────── Deterministic randomness (same people on every run; dates move with «today») ─────────────
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ───────────── Dates (local dates of the garden as YYYY-MM-DD) ─────────────
export function todayLocal(base = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
}
/** Minutes since local midnight right now. */
export function nowMinutesLocal(base = new Date()): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(base);
  const [h, m] = p.split(":").map(Number);
  return h * 60 + m;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}
/** ISO weekday 1 (Mon) … 7 (Sun). */
export function weekday(iso: string): number {
  const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}
export function monthStart(iso: string, delta = 0): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}
/** Timestamp (with offset) of a local date and time «HH:MM». */
export function at(date: string, time: string): string {
  return `${date}T${time.length === 5 ? `${time}:00` : time}${OFFSET}`;
}
export function hm(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
/** Same month/day in another year (birthdays); 29 Feb → 28 Feb. */
export function inYear(iso: string, year: number): string {
  return `${year}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");
}

// ───────────── Writes ─────────────
type Row = Record<string, unknown>;

export function check<T>(res: { data: T; error: { message: string; details?: string | null; hint?: string | null } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}${res.error.details ? ` (${res.error.details})` : ""}`);
  return res.data;
}

/** Bulk insert in chunks (PostgREST needs identical keys in every row of one request). */
export async function insertMany(db: SupabaseClient, table: string, rows: Row[], chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = normalize(rows.slice(i, i + chunk));
    const res = await db.from(table).insert(part);
    if (res.error) throw new Error(`${table}: ${res.error.message}${res.error.details ? ` (${res.error.details})` : ""}`);
  }
}

/** Fills missing keys with null so a chunk has one column set. */
function normalize(rows: Row[]): Row[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return rows.map((r) => {
    const o: Row = {};
    for (const k of keys) o[k] = k in r ? r[k] : null;
    return o;
  });
}

/** Runs async jobs with limited parallelism, keeps the order of results. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function upload(db: SupabaseClient, bucket: string, path: string, body: Buffer, contentType: string) {
  let res = await db.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  for (let i = 0; i < 3 && res.error; i++) {
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    res = await db.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  }
  if (res.error) throw new Error(`upload ${bucket}/${path}: ${res.error.message}`);
}

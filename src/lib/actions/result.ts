import type { PostgrestError } from "@supabase/supabase-js";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Maps Postgres / PostgREST errors to translation keys in the "errors" namespace. */
export function dbErrorCode(e: PostgrestError | { code?: string; message?: string } | null | undefined): string {
  if (!e) return "generic";
  const msg = e.message ?? "";
  // Module SQL raises business errors as `raise exception 'hs:<errorKey>'` (key from messages/*/errors.json).
  const custom = /^hs:([A-Za-z_]+)/.exec(msg);
  if (custom) return custom[1];
  if (["last_owner", "group_has_children", "owner_only", "superadmin_only", "kindergarten mismatch"].some((k) => msg.includes(k))) {
    return msg.includes("kindergarten mismatch") ? "forbidden" : msg.split(" ")[0];
  }
  if (e.code === "42501" || /row-level security|permission denied/i.test(msg)) return "forbidden";
  if (e.code === "23505") return "duplicate";
  if (e.code === "23503") return "inUse";
  if (e.code === "23514" || e.code === "22P02" || e.code === "22007") return "invalid";
  if (e.code === "PGRST116") return "notFound";
  return "generic";
}

export function fail(code: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  return { ok: false, error: code, fieldErrors };
}

/** Converts zod issues to { field: messageKey }. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join(".");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

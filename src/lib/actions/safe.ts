import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadContext, type KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/roles";
import { ActionError, dbErrorCode, fail, zodFieldErrors, type ActionResult } from "./result";

/**
 * Wraps a server action body for the current kindergarten context.
 * Role list is a fast pre-check; RLS remains the source of truth.
 */
export async function kgAction<T = undefined>(
  roles: Role[] | null,
  body: (ctx: KgContext, supabase: SupabaseClient) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const r = await loadContext();
    if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return fail("forbidden");
    // Pre-check against all active roles in this kindergarten (a teacher-parent keeps both).
    if (roles && !r.ctx.roles.some((x) => roles.includes(x))) return fail("forbidden");
    const supabase = await createClient();
    const data = await body(r.ctx, supabase);
    return { ok: true, data } as ActionResult<T>;
  } catch (e) {
    return toFailure(e);
  }
}

export async function superadminAction<T = undefined>(
  body: (userId: string, supabase: SupabaseClient) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const r = await loadContext();
    if (r.state !== "ok" || !r.ctx.isSuperadmin) return fail("forbidden");
    const supabase = await createClient();
    const data = await body(r.ctx.userId, supabase);
    return { ok: true, data } as ActionResult<T>;
  } catch (e) {
    return toFailure(e);
  }
}

function toFailure(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (e instanceof ActionError) return fail(e.code);
  if (e instanceof ValidationError) return fail("invalid", e.fieldErrors);
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
  if (e && typeof e === "object" && "code" in e) return fail(dbErrorCode(e as { code?: string; message?: string }));
  console.error(e);
  return fail("generic");
}

export class ValidationError extends Error {
  constructor(public fieldErrors: Record<string, string>) {
    super("validation");
  }
}

/** Parses input with zod; throws ValidationError with { field: errorKey }. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(zodFieldErrors(r.error.issues));
  return r.data;
}

/**
 * Throws ActionError for a PostgREST error. The return type is non-null for convenience;
 * for writes without `.select()` the value is null and must not be used.
 */
export function check<T>(res: { data: T; error: { code?: string; message?: string } | null }): NonNullable<T> {
  if (res.error) {
    console.error("db error:", res.error.message);
    throw new ActionError(dbErrorCode(res.error));
  }
  return res.data as NonNullable<T>;
}

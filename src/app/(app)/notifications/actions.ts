"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadContext, type AppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ActionError, dbErrorCode, fail, type ActionResult } from "@/lib/actions/result";
import { check, parse, ValidationError } from "@/lib/actions/safe";
import { zUuid } from "@/lib/validation";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";
import { loadNotifications, scopeOr, unreadCount, type NotificationItem } from "@/lib/notifications-data";
import { isAllowedEndpoint } from "@/lib/push";

/** Any signed-in user with a usable context (kindergarten or superadmin) — notifications are personal. */
async function userAction<T>(body: (ctx: AppContext, supabase: SupabaseClient) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const r = await loadContext();
    if (r.state !== "ok") return fail("forbidden");
    const data = await body(r.ctx, await createClient());
    return { ok: true, data } as ActionResult<T>;
  } catch (e) {
    if (e instanceof ActionError) return fail(e.code);
    if (e instanceof ValidationError) return fail("invalid", e.fieldErrors);
    if (e && typeof e === "object" && "code" in e) return fail(dbErrorCode(e as { code?: string; message?: string }));
    console.error(e);
    return fail("generic");
  }
}

const zCursor = z.string().datetime({ offset: true }).nullable().optional();

/** Next page of the centre (older than `before`), or the newest page when `before` is empty. */
export async function loadNotificationsAction(before?: string | null): Promise<ActionResult<{ items: NotificationItem[]; more: boolean }>> {
  return userAction(async (ctx, supabase) => loadNotifications(supabase, ctx, parse(zCursor, before ?? null)));
}

/** Header bell count (current garden scope). */
export async function unreadNotificationsAction(): Promise<ActionResult<number>> {
  return userAction(async (ctx, supabase) => unreadCount(supabase, ctx));
}

/** RLS: only own rows can be updated, and only `read_at` (column grant). */
export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  return userAction(async (ctx, supabase) => {
    const v = parse(zUuid, id);
    check(await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", v).eq("user_id", ctx.userId).is("read_at", null));
    return undefined;
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  return userAction(async (ctx, supabase) => {
    check(await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).is("read_at", null).or(scopeOr(ctx)));
    return undefined;
  });
}

const prefSchema = z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.boolean() });

/** Own preference row (RLS: user_id = auth.uid()). */
export async function setNotificationPreferenceAction(type: string, enabled: boolean): Promise<ActionResult> {
  return userAction(async (ctx, supabase) => {
    const v = parse(prefSchema, { type, enabled });
    // Update first, insert when there is no row yet (users may change only `enabled` of an existing row).
    const now = new Date().toISOString();
    const updated = check(await supabase.from("notification_preferences").update({ enabled: v.enabled, updated_at: now }).eq("user_id", ctx.userId).eq("type", v.type).select("type"));
    if (!updated.length) {
      const ins = await supabase.from("notification_preferences").insert({ user_id: ctx.userId, type: v.type, enabled: v.enabled, updated_at: now });
      if (ins.error?.code === "23505") check(await supabase.from("notification_preferences").update({ enabled: v.enabled, updated_at: now }).eq("user_id", ctx.userId).eq("type", v.type));
      else check(ins);
    }
    return undefined;
  });
}

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, "invalid");
const subSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: b64url.min(20).max(200), auth: b64url.min(8).max(100) }),
  userAgent: z.string().max(500).nullable().optional(),
});

/**
 * Saves this browser's push subscription for the signed-in user. The endpoint must belong to a known push
 * service. Written with the service role (users have no INSERT grant): an endpoint is one browser profile,
 * so a re-login with another account on the same device takes the endpoint over.
 */
export async function savePushSubscriptionAction(input: z.input<typeof subSchema>): Promise<ActionResult> {
  return userAction(async (ctx) => {
    const v = parse(subSchema, input);
    if (!isAllowedEndpoint(v.endpoint)) throw new ActionError("invalid");
    check(
      await createServiceClient()
        .from("push_subscriptions")
        .upsert(
          { user_id: ctx.userId, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, user_agent: v.userAgent?.slice(0, 500) ?? null, last_used_at: new Date().toISOString() },
          { onConflict: "endpoint" },
        ),
    );
    return undefined;
  });
}

/** Removes this browser's subscription (own rows only — RLS delete policy). */
export async function deletePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  return userAction(async (ctx, supabase) => {
    const v = parse(z.string().url().max(2048), endpoint);
    check(await supabase.from("push_subscriptions").delete().eq("endpoint", v).eq("user_id", ctx.userId));
    return undefined;
  });
}

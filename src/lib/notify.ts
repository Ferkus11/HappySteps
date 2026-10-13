import "server-only";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { filterByPreferences, type NotificationType } from "@/lib/notification-types";
import { deferredByQuietHours, laterOf, quietHoursEnd } from "@/lib/quiet-hours";
import { deliverNow } from "@/lib/push";

export { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notification-types";

export interface NotifyInput {
  kindergartenId: string | null;
  userIds: string[];
  type: NotificationType;
  params?: Record<string, string | number | null>;
  url?: string | null;
  /** Push only after this moment (e.g. the end of quiet hours); the in-app row appears at once. */
  deliverAfter?: string | null;
  /** An important announcement: its push is not held back by quiet hours (see deferredByQuietHours). */
  important?: boolean;
}

/** Users who switched this type off in their profile (they get neither a bell row nor a push). */
async function disabledUsers(type: NotificationType, userIds: string[]): Promise<Set<string>> {
  const { data, error } = await createServiceClient()
    .from("notification_preferences")
    .select("user_id")
    .eq("type", type)
    .eq("enabled", false)
    .in("user_id", userIds);
  if (error) console.error("notify: preferences", error.message);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

/** End of the garden's current quiet hours (ISO), or null outside them / without a garden. */
async function quietUntil(kindergartenId: string | null, now: Date): Promise<string | null> {
  if (!kindergartenId) return null;
  const { data } = await createServiceClient()
    .from("kindergarten_settings")
    .select("timezone, quiet_hours_start, quiet_hours_end")
    .eq("kindergarten_id", kindergartenId)
    .maybeSingle();
  const end = quietHoursEnd(now, (data?.timezone as string) ?? "Asia/Almaty", (data?.quiet_hours_start as string) ?? "21:00", (data?.quiet_hours_end as string) ?? "08:00");
  return end ? end.toISOString() : null;
}

/** Runs push delivery after the response when inside a request; directly otherwise (scripts). */
function schedule(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Creates in-app notifications and sends Web Push (lib/push.ts).
 * Call ONLY after the action has verified the actor's permissions — this uses the service role.
 * - Types a recipient switched off in the profile are skipped entirely (no bell row, no push).
 * - During the garden's quiet hours the bell row appears at once; the push of a routine type waits for the end
 *   of them (`deliver_after`; /api/cron/push-deferred sends it). Which types wait: deferredByQuietHours().
 * Never throws: a notification problem must not fail the action that caused it.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    let ids = [...new Set(input.userIds.filter(Boolean))];
    if (!ids.length) return;
    ids = filterByPreferences(ids, await disabledUsers(input.type, ids));
    if (!ids.length) return;
    const now = new Date();
    const garden = deferredByQuietHours(input.type, { important: input.important }) ? await quietUntil(input.kindergartenId, now) : null;
    const deliverAfter = laterOf(input.deliverAfter, garden);
    const rows = ids.map((user_id) => ({
      kindergarten_id: input.kindergartenId,
      user_id,
      type: input.type,
      params: input.params ?? {},
      url: input.url ?? null,
      deliver_after: deliverAfter,
    }));
    const { data, error } = await createServiceClient().from("notifications").insert(rows).select("id");
    if (error) {
      console.error("notify failed", input.type, error.message);
      return;
    }
    // A push in the future is left for the cron; otherwise it goes out right after the response.
    if (deliverAfter && new Date(deliverAfter).getTime() > now.getTime()) return;
    const inserted = (data ?? []).map((r) => r.id as string);
    if (inserted.length) schedule(() => deliverNow(inserted));
  } catch (e) {
    console.error("notify failed", input.type, e instanceof Error ? e.message : e);
  }
}

/** Active members of a kindergarten with given roles (for fan-out). */
export async function memberIds(kindergartenId: string, roles: string[]): Promise<string[]> {
  const { data } = await createServiceClient()
    .from("memberships")
    .select("user_id")
    .eq("kindergarten_id", kindergartenId)
    .eq("status", "active")
    .in("role", roles);
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

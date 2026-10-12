import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Notification types (SPEC §5.12). Text lives in messages/<locale>/notifications.json
 * under `types.<type>.title` / `types.<type>.body`, rendered with `params` in the reader's language.
 */
export const NOTIFICATION_TYPES = [
  "message.new",
  "announcement.new",
  "announcement.reminder",
  "event.reminder",
  "absence.reported",
  "attendance.not_marked",
  "receipt.new",
  "receipt.accepted",
  "receipt.rejected",
  "club.request",
  "club.spot_free",
  "club.decision",
  "waitlist.new",
  "document.expiring",
  "worktime.auto_closed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotifyInput {
  kindergartenId: string | null;
  userIds: string[];
  type: NotificationType;
  params?: Record<string, string | number | null>;
  url?: string | null;
  /** Push only after this moment (e.g. the end of quiet hours); the in-app row appears at once. */
  deliverAfter?: string | null;
}

/**
 * Creates in-app notifications (and, from stage 6, sends Web Push).
 * Call ONLY after the action has verified the actor's permissions — this uses the service role.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const ids = [...new Set(input.userIds.filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map((user_id) => ({
    kindergarten_id: input.kindergartenId,
    user_id,
    type: input.type,
    params: input.params ?? {},
    url: input.url ?? null,
    deliver_after: input.deliverAfter ?? null,
  }));
  const { error } = await createServiceClient().from("notifications").insert(rows);
  if (error) console.error("notify failed", input.type, error.message);
  await deliver(rows);
}

/** Push delivery hook — implemented in stage 6 (lib/push.ts); must skip rows whose `deliver_after` is in the future. */
async function deliver(_rows: { user_id: string; type: string; deliver_after: string | null }[]): Promise<void> {}

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

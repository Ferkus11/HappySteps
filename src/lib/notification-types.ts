import type { Role } from "@/lib/auth/roles";

/**
 * Notification types (SPEC §5.12). Text lives in messages/<locale>/notifications.json
 * under `types.<type>.title` / `types.<type>.body`, rendered with `params` in the reader's language.
 * Client-safe (no server imports): the profile preferences and the centre use it too.
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

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

const ALL: Role[] = ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"];
const STAFF: Role[] = ["owner", "head", "accountant", "teacher", "club_teacher", "cook"];

/**
 * Which roles receive a type (mirrors the `notify()` call sites). Used to show only relevant switches in the
 * profile and to pick the role when a push from another garden is opened.
 */
export const NOTIFICATION_AUDIENCE: Record<NotificationType, Role[]> = {
  "message.new": ALL,
  "announcement.new": ALL,
  "announcement.reminder": ALL,
  "event.reminder": ALL,
  "absence.reported": ["teacher"],
  "attendance.not_marked": ["teacher", "head", "owner"],
  "receipt.new": ["accountant", "owner"],
  "receipt.accepted": ["parent"],
  "receipt.rejected": ["parent"],
  "club.request": ["owner", "head", "club_teacher"],
  "club.spot_free": ["owner", "head"],
  "club.decision": ["parent"],
  "waitlist.new": ["owner", "head"],
  "document.expiring": STAFF,
  "worktime.auto_closed": STAFF,
};

/** Types a person with these roles (in any garden) can receive, in the canonical order. */
export function typesForRoles(roles: readonly Role[]): NotificationType[] {
  return NOTIFICATION_TYPES.filter((t) => NOTIFICATION_AUDIENCE[t].some((r) => roles.includes(r)));
}

/** Keeps only the users who have not switched the type off (`disabled` = user ids with enabled = false). */
export function filterByPreferences(userIds: readonly string[], disabled: ReadonlySet<string>): string[] {
  return userIds.filter((id) => !disabled.has(id));
}

/**
 * «Требует внимания» on the owner/head dashboard (SPEC §6, PLAN stage 5): pure logic, no I/O.
 * The card shows one line per kind with a non-zero count; an empty list means «Всё в порядке».
 */

export const ATTENTION_KINDS = ["unmarkedGroups", "receipts", "clubRequests", "clubQueue", "documents", "waitlist"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface AttentionCounts {
  /** Groups with active children not fully marked today (only counted after the reminder time). */
  unmarkedGroups: number;
  /** The only unmarked group (to link straight to it), when exactly one. */
  unmarkedGroupId?: string | null;
  /** Receipts waiting for the accountant's review. `null` — the role can't see payments. */
  receipts: number | null;
  clubRequests: number;
  /** Queued children for whom a place is free (head confirms in order). */
  clubQueue: number;
  /** Staff documents expired or expiring within 30 days. */
  documents: number;
  /** New (not yet contacted) waitlist applications. */
  waitlist: number;
}

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  href: string;
}

/** Lines to show, in a fixed order; zero (and hidden) counts are dropped. */
export function attentionItems(c: AttentionCounts): AttentionItem[] {
  const all: AttentionItem[] = [
    {
      kind: "unmarkedGroups",
      count: c.unmarkedGroups,
      href: c.unmarkedGroups === 1 && c.unmarkedGroupId ? `/attendance?group=${c.unmarkedGroupId}` : "/attendance",
    },
    { kind: "receipts", count: c.receipts ?? 0, href: "/payments" },
    { kind: "clubRequests", count: c.clubRequests, href: "/clubs" },
    { kind: "clubQueue", count: c.clubQueue, href: "/clubs" },
    { kind: "documents", count: c.documents, href: "/documents?tab=staff&filter=expiring" },
    { kind: "waitlist", count: c.waitlist, href: "/waitlist" },
  ];
  return all.filter((i) => i.count > 0);
}

/** "HH:MM[:SS]" → minutes since midnight; invalid → null. */
export function minutesOf(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Is the local time `now` ("HH:MM") at or after `reminder` (the attendance reminder setting)? */
export function reminderPassed(now: string, reminder: string | null | undefined): boolean {
  const n = minutesOf(now);
  const r = minutesOf(reminder) ?? 10 * 60;
  return n !== null && n >= r;
}

/** Groups with active children where someone is still unmarked (a reported absence counts as marked). */
export function unmarkedGroups<T extends { group_id: string; active: number; unmarked: number }>(rows: T[]): T[] {
  return rows.filter((r) => r.active > 0 && r.unmarked > 0);
}

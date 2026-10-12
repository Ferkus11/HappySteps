/** Pure helpers for clubs (SPEC §5.10). No server imports — used by components and unit tests. */

export const ENROLLMENT_STATUSES = ["requested", "queued", "active", "rejected", "left", "excluded"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const OPEN_STATUSES: EnrollmentStatus[] = ["requested", "queued", "active"];

export interface ScheduleItem {
  day: number; // ISO weekday 1 = Monday … 7 = Sunday
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface ClubStats {
  capacity: number;
  active: number;
  requested: number;
  queued: number;
  free: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Same rule as SQL `club_schedule_valid`. */
export function scheduleValid(items: ScheduleItem[]): boolean {
  return (
    items.length <= 14 &&
    items.every((i) => Number.isInteger(i.day) && i.day >= 1 && i.day <= 7 && TIME.test(i.start) && TIME.test(i.end) && i.start < i.end)
  );
}

/** Normalises a schedule: sorted by day and time, duplicates removed. */
export function normalizeSchedule(items: ScheduleItem[]): ScheduleItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    .filter((i) => {
      const k = `${i.day}|${i.start}|${i.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Groups days with the same time: [{days: [2, 4], start: "16:00", end: "16:45"}] → «Вт, Чт · 16:00–16:45». */
export function groupSchedule(items: ScheduleItem[]): { days: number[]; start: string; end: string }[] {
  const out: { days: number[]; start: string; end: string }[] = [];
  for (const i of normalizeSchedule(items)) {
    const g = out.find((x) => x.start === i.start && x.end === i.end);
    if (g) g.days.push(i.day);
    else out.push({ days: [i.day], start: i.start, end: i.end });
  }
  return out;
}

/** Inclusive age range in full years, like SQL `club_request`. */
export function ageFits(club: { age_from: number; age_to: number }, age: number): boolean {
  return age >= club.age_from && age <= club.age_to;
}

/**
 * What a confirmation would do (mirrors SQL `club_confirm`): the queue has priority over new requests,
 * and a queued child can be confirmed only when its position fits in the free places.
 */
export function confirmOutcome(
  e: { status: EnrollmentStatus; position?: number | null },
  stats: Pick<ClubStats, "free" | "queued">,
): "active" | "queued" | "full" | "order" | "closed" {
  if (e.status === "requested") return stats.free > stats.queued ? "active" : "queued";
  if (e.status !== "queued") return "closed";
  if (stats.free <= 0) return "full";
  return (e.position ?? Infinity) <= stats.free ? "active" : "order";
}

/** The state a new request lands in. */
export function requestOutcome(stats: Pick<ClubStats, "free" | "queued">): "requested" | "queued" {
  return stats.free > stats.queued ? "requested" : "queued";
}

export function statusTone(s: EnrollmentStatus): "success" | "sky" | "warning" | "neutral" | "danger" {
  switch (s) {
    case "active":
      return "success";
    case "requested":
      return "sky";
    case "queued":
      return "warning";
    case "excluded":
      return "danger";
    default:
      return "neutral";
  }
}

/** Club ids in the order a parent sees them: own open enrollments first, then by name. */
export function sortCatalog<T extends { id: string; name: string }>(clubs: T[], openIds: Set<string>): T[] {
  return [...clubs].sort((a, b) => Number(openIds.has(b.id)) - Number(openIds.has(a.id)) || a.name.localeCompare(b.name, "ru"));
}

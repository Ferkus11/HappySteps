import { periodParts } from "@/lib/payments";

type T = (key: string, values?: Record<string, string | number>) => string;

/** "Октябрь 2026" / "2026 ж. Қазан" from a YYYY-MM-01 (or YYYY-MM) period, using the payments namespace. */
export function monthLabel(t: T, period: string): string {
  const { month, year } = periodParts(period.length === 7 ? `${period}-01` : period);
  return t("monthYear", { month: t(`months.${month}`), year });
}

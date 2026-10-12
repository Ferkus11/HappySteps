import { periodParts } from "@/lib/payments";

type T = (key: string, values?: Record<string, string | number>) => string;

const parts = (period: string) => periodParts(period.length === 7 ? `${period}-01` : period);

/** Standalone label: "Октябрь 2026" / "2026 ж. Қазан" from a YYYY-MM-01 (or YYYY-MM) period (payments namespace). */
export function monthLabel(t: T, period: string): string {
  const { month, year } = parts(period);
  return t("monthYear", { month: t(`months.${month}`), year });
}

/** Mid-sentence form for "Счёт за {month}": "октябрь 2026" / "2026 жылғы қазан". */
export function monthPhrase(t: T, period: string): string {
  const { month, year } = parts(period);
  return t("monthInline", { month: t(`monthsLower.${month}`), year });
}

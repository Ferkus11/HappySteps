import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { localTime, type DayRow } from "@/lib/worktime";

const tones = {
  work: "success",
  done: "sky",
  late: "warning",
  absent: "brand",
  unmarked: "lavender",
  upcoming: "neutral",
  off: "neutral",
} as const;

export async function DayStatusBadge({ row }: { row: DayRow }) {
  const t = await getTranslations("worktime");
  const label =
    row.status === "absent" && row.absence_kind
      ? t(`absence.${row.absence_kind}`)
      : row.status === "off" && row.is_holiday && row.shift_source === "holiday"
        ? t("holiday")
        : t(`status.${row.status}`);
  return (
    <Badge tone={tones[row.status]} data-testid={`status-${row.status}`}>
      {label}
    </Badge>
  );
}

/** "08:05–12:00 · 13:00–…" in the kindergarten time zone. */
export function sessionsText(row: DayRow, tz: string): string {
  return row.sessions.map((s) => `${localTime(s.started_at, tz)}–${s.ended_at ? localTime(s.ended_at, tz) : "…"}`).join(" · ");
}

/** Small markers: closed automatically / edited / outside schedule / late minutes. */
export async function DayMarkers({ row }: { row: DayRow }) {
  const t = await getTranslations("worktime");
  return (
    <>
      {row.status === "late" ? <Badge tone="warning">{t("lateBy", { count: row.late_minutes })}</Badge> : null}
      {row.outside_schedule ? <Badge tone="lavender">{t("outsideSchedule")}</Badge> : null}
      {row.auto_closed ? (
        <Badge tone="warning" data-testid="marker-auto">
          {t("autoClosed")}
        </Badge>
      ) : null}
      {row.edited ? (
        <Badge tone="neutral" data-testid="marker-edited">
          {t("edited")}
        </Badge>
      ) : null}
    </>
  );
}

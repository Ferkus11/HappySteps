import { useTranslations } from "next-intl";
import { Shapes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { groupSchedule, statusTone, type ClubStats, type EnrollmentStatus, type ScheduleItem } from "@/lib/clubs";
import { cn } from "@/lib/utils";

/** «Вт, Чт · 16:00–16:45» lines (days with the same time are grouped). */
export function ScheduleText({ schedule, className }: { schedule: ScheduleItem[]; className?: string }) {
  const t = useTranslations("clubs");
  const groups = groupSchedule(schedule);
  if (!groups.length) return <span className={className}>{t("noSchedule")}</span>;
  return (
    <span className={className}>
      {groups.map((g, i) => (
        <span key={i} className="block">
          {g.days.map((d) => t(`days.${d}` as "days.1")).join(", ")} · {g.start}–{g.end}
        </span>
      ))}
    </span>
  );
}

export function AgeRange({ from, to }: { from: number; to: number }) {
  const t = useTranslations("clubs");
  return <>{t("ageRange", { from, to })}</>;
}

/** «Свободно 3 из 8» / «Мест нет · 2 в очереди». */
export function PlacesText({ stats, className }: { stats: ClubStats; className?: string }) {
  const t = useTranslations("clubs");
  const full = stats.free <= 0;
  return (
    <span className={cn(full ? "text-warning" : "text-success", "font-semibold", className)} data-testid="club-places" data-free={stats.free}>
      {full ? t("places.full") : t("places.free", { free: stats.free, capacity: stats.capacity })}
      {stats.queued > 0 ? <span className="font-medium text-muted"> · {t("places.queue", { count: stats.queued })}</span> : null}
    </span>
  );
}

export function EnrollmentBadge({ status, position, className }: { status: EnrollmentStatus; position?: number | null; className?: string }) {
  const t = useTranslations("clubs");
  return (
    <Badge tone={statusTone(status)} className={className} data-testid="enrollment-status" data-status={status}>
      {t(`status.${status}`, { position: position ?? "—" })}
    </Badge>
  );
}

const TINTS = ["#EAF5FD", "#FCE4EC", "#E8F5E9", "#FFF3E0", "#EDE7F6", "#E0F7FA"];
const INKS = ["#1F6FA8", "#AD1457", "#2E7D32", "#B45309", "#5E35B1", "#00838F"];

/** Club photo (signed URL) or a soft placeholder tinted by the club name. */
export function ClubPhoto({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const i = h % TINTS.length;
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: TINTS[i] }} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center" style={{ color: INKS[i] }}>
          <Shapes className="size-9 opacity-70" />
        </div>
      )}
    </div>
  );
}

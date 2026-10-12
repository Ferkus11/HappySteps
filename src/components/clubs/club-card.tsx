import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarDays, MapPin, UserRound } from "lucide-react";
import type { Club } from "@/lib/clubs-data";
import type { ClubStats } from "@/lib/clubs";
import { Badge } from "@/components/ui/badge";
import { AgeRange, ClubPhoto, PlacesText, ScheduleText } from "./bits";

/** Catalog card: photo, name, age, schedule, place, teacher, places. The whole card opens the club. */
export function ClubCard({
  club,
  stats,
  photo,
  href,
  status,
  showTeacher = true,
}: {
  club: Club;
  stats: ClubStats;
  photo?: string | null;
  href: string;
  status?: React.ReactNode;
  showTeacher?: boolean;
}) {
  const t = useTranslations("clubs");
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-border/70 bg-surface shadow-card transition-shadow hover:shadow-md"
      data-testid="club-card"
      data-club={club.name}
    >
      <ClubPhoto name={club.name} src={photo} className="h-24 w-full sm:h-32" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[16px] leading-snug font-bold group-hover:text-brand">{club.name}</h3>
          <Badge tone="lavender" className="shrink-0">
            <AgeRange from={club.age_from} to={club.age_to} />
          </Badge>
        </div>
        <div className="space-y-1 text-[13px] text-muted">
          <div className="flex gap-2">
            <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <ScheduleText schedule={club.schedule} />
          </div>
          {club.place ? (
            <div className="flex gap-2">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{club.place}</span>
            </div>
          ) : null}
          {showTeacher && club.teacher_name ? (
            <div className="flex gap-2">
              <UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{club.teacher_name}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-[13px]">
          <PlacesText stats={stats} />
          {status ?? <span className="sr-only">{t("placesLabel")}</span>}
        </div>
      </div>
    </Link>
  );
}

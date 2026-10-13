import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { effectiveStatus, isWorkingDay, monthOf, reportCovering, type AbsenceReport, type AttendanceRow, type HolidayRow } from "@/lib/attendance-logic";
import { addDays, formatDate, todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReportAbsenceButton } from "./absence-dialog";
import { AbsenceList } from "./absence-list";

/** Child card section: last two weeks of attendance, reports, and "Ребёнок не придёт" for parents. */
export async function ChildAttendanceCard({ ctx, child }: { ctx: KgContext; child: { id: string; full_name: string; status: string; group_id: string | null } }) {
  if (!["owner", "head", "accountant", "teacher", "parent"].includes(ctx.role)) return null;
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const from = addDays(today, -13);
  const [{ data: rows }, { data: reports }, { data: holidays }] = await Promise.all([
    supabase.from("child_attendance").select("child_id, date, status, reason").eq("child_id", child.id).gte("date", from).lte("date", today),
    supabase.from("absence_reports").select("id, child_id, date_from, date_to, reason, comment").eq("child_id", child.id).is("cancelled_at", null).gte("date_to", from).order("date_from"),
    supabase.from("holidays").select("date, kind").eq("kindergarten_id", ctx.kg.id).gte("date", from).lte("date", today),
  ]);
  const reps = (reports ?? []) as AbsenceReport[];
  const rowBy = new Map(((rows ?? []) as AttendanceRow[]).map((r) => [r.date, r]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i)).filter((d) => isWorkingDay(d, (holidays ?? []) as HolidayRow[]));
  const cells = days.map((d) => ({ d, e: effectiveStatus(rowBy.get(d), reportCovering(reps, child.id, d)) }));
  const isParent = ctx.role === "parent";
  const upcoming = reps.filter((r) => r.date_to >= today);
  const canReport = (isParent || ctx.role === "owner" || ctx.role === "head") && child.status === "active";
  return (
    <Card data-testid="child-attendance">
      <CardHeader
        title={t("title")}
        href={!isParent && child.group_id ? `/attendance/report?group=${child.group_id}&month=${monthOf(today)}` : undefined}
      />
      <div className="flex flex-wrap gap-1.5" aria-label={t("lastTwoWeeks")}>
        {cells.map(({ d, e }) => (
          <span
            key={d}
            title={`${formatDate(d)} · ${e.status === "present" ? t("present") : e.status === "absent" ? (e.reason ? t(`reasons.${e.reason}`) : t("absent")) : t("notMarked")}`}
            className={cn(
              "grid h-10 w-9 place-items-center rounded-lg text-[12px] font-bold",
              e.status === "present" && "bg-tile-work text-tile-work-fg",
              e.status === "absent" && "bg-tile-absent text-tile-absent-fg",
              e.status === "none" && "bg-surface-muted text-faint",
              d === today && "ring-2 ring-brand/40",
            )}
          >
            {Number(d.slice(8))}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">{t("lastTwoWeeks")}</p>
      {upcoming.length ? (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-faint">{t("reportedAbsences")}</div>
          {isParent || ctx.role === "owner" || ctx.role === "head" ? (
            <AbsenceList today={today} items={upcoming} />
          ) : (
            <ul className="space-y-1 text-sm">
              {upcoming.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{t(`reasons.${r.reason}`)}</span>{" "}
                  <span className="text-muted">
                    {r.date_from === r.date_to ? formatDate(r.date_from) : `${formatDate(r.date_from)} — ${formatDate(r.date_to)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {canReport ? <ReportAbsenceButton kids={[{ id: child.id, name: child.full_name }]} childId={child.id} today={today} className="mt-4 w-full" /> : null}
      {!isParent && child.group_id && ["owner", "head", "teacher"].includes(ctx.role) ? (
        <Link href={`/attendance?group=${child.group_id}`} className="mt-3 flex min-h-11 items-center justify-center text-sm font-semibold text-brand">
          {t("openMarking")}
        </Link>
      ) : null}
    </Card>
  );
}

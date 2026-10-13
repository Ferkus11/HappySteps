import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheet, Table2, Users } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { loadDays } from "@/lib/queries/worktime";
import { buildTimesheet, formatHours, tileCounts } from "@/lib/worktime";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { WorkdayCard } from "./workday-card";
import { WorktimeTiles } from "./status-tiles";

/** Owner/head (and accountant, view only): today's work-time tiles. */
async function WorktimeTodayWidget({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("worktime");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const rows = await loadDays(supabase, ctx.kg.id, today, today);
  return (
    <Card>
      <CardHeader title={t("title")} href="/worktime" />
      <WorktimeTiles counts={tileCounts(rows)} href={(s) => `/worktime?status=${s}`} />
      <div className="mt-3 flex justify-end">
        <Link href="/worktime" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline" data-testid="worktime-staff-list">
          <Users className="size-4" aria-hidden /> {t("staffList")}
        </Link>
      </div>
    </Card>
  );
}

/** Accountant: «Табель» — this month so far (hours, lates, absences) + open / export (SPEC §6). */
async function TimesheetWidget({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("worktime");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const month = today.slice(0, 7);
  const people = buildTimesheet(await loadDays(supabase, ctx.kg.id, `${month}-01`, today));
  const sum = people.reduce(
    (s, p) => ({ minutes: s.minutes + p.totals.minutes, lates: s.lates + p.totals.lates, missed: s.missed + p.totals.missed + p.totals.absences }),
    { minutes: 0, lates: 0, missed: 0 },
  );
  return (
    <Card data-testid="timesheet-widget">
      <CardHeader title={`${t("timesheet")} · ${t(`months.${Number(month.slice(5))}`)}`} href={`/worktime/timesheet?month=${month}`} />
      <div className="grid grid-cols-3 gap-3">
        <Stat value={<span className="text-[24px]">{formatHours(sum.minutes)}</span>} label={t("timesheetWidget.hours")} />
        <Stat value={<span className="text-[24px]">{sum.lates}</span>} label={t("timesheetWidget.lates")} />
        <Stat value={<span className="text-[24px]">{sum.missed}</span>} label={t("timesheetWidget.missed")} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary" className="flex-1">
          <Link href={`/worktime/timesheet?month=${month}`} data-testid="timesheet-open">
            <Table2 /> {t("timesheetOpen")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <a href={`/worktime/timesheet/export?month=${month}&format=xlsx`} download>
            <FileSpreadsheet /> .xlsx
          </a>
        </Button>
      </div>
    </Card>
  );
}

export const worktimeWidgets: DashboardWidget[] = [
  // Owner only if they have a schedule (WorkdayCard returns null otherwise).
  { id: "worktime-day", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook"], slot: "top", order: 10, Component: WorkdayCard },
  { id: "worktime-today", roles: ["owner", "head"], slot: "main", order: 10, wide: true, Component: WorktimeTodayWidget },
  { id: "worktime-timesheet", roles: ["accountant"], slot: "main", order: 4, Component: TimesheetWidget },
];

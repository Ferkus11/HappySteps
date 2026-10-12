import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadDays, myOpenSession, hasSchedule } from "@/lib/queries/worktime";
import { formatDuration, localTime } from "@/lib/worktime";
import { formatDate, todayIn } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkdayButton } from "./workday-button";

/**
 * Start/finish card for the signed-in staff member. `ownerNeedsSchedule`: the owner sees it only
 * when they have a schedule (or already marked time).
 */
export async function WorkdayCard({ ctx, ownerNeedsSchedule = true }: { ctx: KgContext; ownerNeedsSchedule?: boolean }) {
  const t = await getTranslations("worktime");
  const supabase = await createClient();
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);
  const [rows, open, scheduled] = await Promise.all([
    loadDays(supabase, ctx.kg.id, today, today),
    myOpenSession(supabase, ctx.kg.id, ctx.userId),
    ctx.role === "owner" && ownerNeedsSchedule ? hasSchedule(supabase, ctx.kg.id, ctx.userId) : Promise.resolve(true),
  ]);
  const me = rows.find((r) => r.user_id === ctx.userId);
  if (ctx.role === "owner" && ownerNeedsSchedule && !scheduled && !open && !me?.sessions.length) return null;

  const shift = me?.shift_start && me.shift_end ? t("shift", { start: me.shift_start, end: me.shift_end }) : me?.is_holiday ? t("holidayToday") : t("noShiftToday");
  const since = open ? localTime(open.started_at, tz) : null;
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="workday-card">
      <div className="flex min-w-0 items-start gap-3">
        <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ${open ? "bg-tile-work text-tile-work-fg" : "bg-sky-soft text-sky-strong"}`}>
          <Clock className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{open ? t("atWorkSince", { time: since! }) : t("workday")}</div>
          <div className="mt-0.5 text-sm text-muted">{shift}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {me && me.worked_minutes > 0 ? (
              <Badge tone="sky" data-testid="worked-today">
                {t("workedToday", { time: formatDuration(me.worked_minutes) })}
              </Badge>
            ) : null}
            {me && me.sessions.length > 1 ? <Badge tone="neutral">{t("intervals", { count: me.sessions.length })}</Badge> : null}
            {me?.status === "late" ? <Badge tone="warning">{t("lateBy", { count: me.late_minutes })}</Badge> : null}
            {me?.outside_schedule ? <Badge tone="lavender">{t("outsideSchedule")}</Badge> : null}
            {open && open.work_date !== today ? <Badge tone="warning">{t("openSince", { date: formatDate(open.work_date) })}</Badge> : null}
          </div>
        </div>
      </div>
      <WorkdayButton open={!!open} />
    </Card>
  );
}

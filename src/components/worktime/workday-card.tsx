import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadDays, myOpenSession, hasSchedule } from "@/lib/queries/worktime";
import { localTime } from "@/lib/worktime";
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
  // The day has already begun (an earlier interval is closed): the button continues it, it does not «start» it.
  const resume = !open && (me?.sessions.length ?? 0) > 0;
  const worked = me && me.worked_minutes > 0 ? me.worked_minutes : 0;
  const late = me?.status === "late" ? me.late_minutes : 0;
  // One plain line instead of «2 интервала» + badges: «Сегодня: 1 ч 20 мин · опоздание 60 мин».
  const summary = [
    worked ? t("todayWorked", { time: duration(t, worked) }) : null,
    late ? (worked ? t("lateShort", { count: late }) : t("lateBy", { count: late })) : null,
  ].filter(Boolean);
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="workday-card" data-state={open ? "open" : resume ? "paused" : "new"}>
      <div className="flex min-w-0 items-start gap-3">
        <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ${open ? "bg-tile-work text-tile-work-fg" : "bg-sky-soft text-sky-strong"}`}>
          <Clock className="size-6" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{open ? t("atWorkSince", { time: since! }) : t("workday")}</div>
          <div className="mt-0.5 text-sm text-muted">{shift}</div>
          {summary.length ? (
            <div className="mt-1 text-sm font-semibold text-text" data-testid="worked-today">
              {worked ? summary[0] : null}
              {late ? (
                <>
                  {worked ? " · " : null}
                  <span className="text-warning" data-testid="workday-late">
                    {summary[summary.length - 1]}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          {me?.outside_schedule || (open && open.work_date !== today) ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {me?.outside_schedule ? <Badge tone="lavender">{t("outsideSchedule")}</Badge> : null}
              {open && open.work_date !== today ? <Badge tone="warning">{t("openSince", { date: formatDate(open.work_date) })}</Badge> : null}
            </div>
          ) : null}
        </div>
      </div>
      <WorkdayButton open={!!open} resume={resume} />
    </Card>
  );
}

/** «1 ч 20 мин» / «45 мин» (the card speaks in words; tables keep «1:20»). */
function duration(t: (key: string, values?: Record<string, number>) => string, minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return !h ? t("durationM", { m }) : m % 60 ? t("durationHm", { h, m: m % 60 }) : t("durationH", { h });
}

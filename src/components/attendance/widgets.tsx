import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarOff, CheckCircle2, CircleDashed, ClipboardCheck } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, isWorkingDayDb, loadGroupDay, loadPortions } from "@/lib/attendance";
import { myOpenSession } from "@/lib/queries/worktime";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PortionsCard } from "./portions-card";
import { ReasonIcon } from "./reason";

/**
 * Owner/head top row: present today with a ring. Before any child is marked the card is neutral (dashed ring,
 * «Ещё не отмечено · 0 из 2 групп») — a big 0 and an empty 0% ring read as «nobody came». Once marking has started
 * the ring shows who came of those expected (active children minus the absent ones).
 */
async function AttendanceTodayStat({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const [working, rows] = await Promise.all([isWorkingDayDb(supabase, ctx.kg.id, today), loadPortions(supabase, ctx.kg.id, today)]);
  const active = rows.reduce((s, r) => s + r.active, 0);
  const present = rows.reduce((s, r) => s + (r.present ?? 0), 0);
  const absent = rows.reduce((s, r) => s + r.absent, 0);
  const withChildren = rows.filter((r) => r.active > 0);
  const unmarkedGroups = withChildren.filter((r) => r.unmarked > 0).length;
  // nothing marked yet: no teacher mark in any group (a parent's report alone does not start the day)
  const notStarted = working && active > 0 && rows.every((r) => r.marked === 0);
  const expected = rows.reduce((s, r) => s + r.expected, 0);
  return (
    <Link href="/attendance" className="block h-full">
      <Card className="flex h-full items-center justify-between gap-3 hover:shadow-md" data-testid="dash-attendance" data-state={!working ? "off" : notStarted ? "pending" : "marked"}>
        <Stat
          value={
            <span data-testid="dash-attendance-present" data-present={present} className={notStarted ? "text-faint" : undefined}>
              {working && !notStarted ? present : "—"}
            </span>
          }
          label={t("todayCard")}
          sub={
            !working ? (
              t("dayOff")
            ) : notStarted ? (
              <span data-testid="dash-attendance-absent">{t("notMarkedStat", { marked: 0, total: withChildren.length })}</span>
            ) : (
              <span data-testid="dash-attendance-absent">
                {t("absentToday", { count: absent })}
                {unmarkedGroups ? ` · ${t("groupsUnmarked", { count: unmarkedGroups })}` : ""}
              </span>
            )
          }
        />
        {working ? <Ring value={expected > 0 ? (present / expected) * 100 : 0} color="var(--success)" pending={notStarted} label={t("expectedLabel")} /> : null}
      </Card>
    </Link>
  );
}

/**
 * Teacher: "Моя группа сегодня" — marked or not, who won't come and why, "Отметить".
 * One primary action per screen (SPEC §8): while «Начать рабочий день» is shown (no open session),
 * «Отметить» is secondary; once the day has started it becomes the primary action (of the first unmarked group).
 * One group fills the row on desktop (status · who won't come · button side by side).
 */
async function TeacherToday({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const groups = await attendanceGroups(supabase, ctx);
  if (!groups.length) return null;
  const working = await isWorkingDayDb(supabase, ctx.kg.id, today);
  if (!working) {
    return (
      <Card className="flex items-center gap-3" data-testid="teacher-today">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sky-soft text-sky-strong">
          <CalendarOff className="size-5" aria-hidden />
        </span>
        <div>
          <div className="font-bold">{t("myGroupToday")}</div>
          <div className="text-sm text-muted">{t("dayOff")}</div>
        </div>
      </Card>
    );
  }
  const [days, open] = await Promise.all([
    Promise.all(groups.map((g) => loadGroupDay(supabase, g.id, today))),
    myOpenSession(supabase, ctx.kg.id, ctx.userId),
  ]);
  const single = groups.length === 1;
  const isDone = (list: (typeof days)[number]) => list.length > 0 && list.every((c) => c.effective.status !== "none");
  // With several groups only the first unmarked one gets the primary button.
  const primaryAt = open ? days.findIndex((list) => !isDone(list)) : -1;
  return (
    <div className={cn("grid gap-4", !single && "lg:grid-cols-2")}>
      {groups.map((g, i) => {
        const list = days[i];
        const marked = list.filter((c) => c.effective.status !== "none").length;
        const present = list.filter((c) => c.effective.status === "present").length;
        const done = isDone(list);
        const variant = done ? "outline" : i === primaryAt ? "primary" : "secondary";
        const away = list.filter((c) => c.effective.status === "absent");
        return (
          <Card key={g.id} data-testid="teacher-today">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
                  {t("myGroupToday")} · <span data-user-content>{g.name}</span>
                </span>
              }
            />
            <div className={cn(single && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-start lg:gap-8")}>
            <div className="flex items-center gap-3">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", done ? "bg-success-soft text-success" : "bg-tile-unmarked text-tile-unmarked-fg")}>
                {done ? <CheckCircle2 className="size-5" aria-hidden /> : <CircleDashed className="size-5" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold" data-testid="teacher-today-status">
                  {done ? t("groupMarked") : marked ? `${t("progressLabel")} ${t("progress", { marked, total: list.length })}` : t("groupNotMarked")}
                </div>
                <div className="text-sm text-muted">{t("presentOf", { present, total: list.length })}</div>
              </div>
            </div>
            {away.length ? (
              <div className={cn("mt-4", single && "lg:mt-0")}>
                <div className="mb-2 text-xs font-semibold text-faint">{t("wontCome")}</div>
                <ul className="space-y-1.5">
                  {away.map((c) => {
                    const reason = c.effective.status === "absent" ? c.effective.reason : null;
                    return (
                      <li key={c.id} className="flex items-center gap-2 text-sm" data-testid="teacher-today-absent">
                        <span className="text-tile-absent-fg">
                          <ReasonIcon reason={reason} />
                        </span>
                        <span data-user-content className="min-w-0 truncate font-semibold">{c.name}</span>
                        <span className="shrink-0 text-muted">{reason ? t(`reasons.${reason}`) : t("absent")}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : single ? (
              <p className="mt-4 text-sm text-muted lg:mt-2.5" data-testid="teacher-today-none-away">
                {t("noneReported")}
              </p>
            ) : null}
            <Button asChild size="lg" variant={variant} className={cn("mt-4 w-full", single && "lg:mt-0 lg:w-auto lg:px-8")}>
              <Link href={`/attendance?group=${g.id}`} data-testid="teacher-mark" data-variant={variant}>
                <ClipboardCheck /> {done ? t("open") : t("mark")}
              </Link>
            </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export const attendanceWidgets: DashboardWidget[] = [
  { id: "attendance-today", roles: ["owner", "head"], slot: "stat", order: 10, wide: true, Component: AttendanceTodayStat },
  { id: "attendance-teacher", roles: ["teacher"], slot: "top", order: 20, Component: TeacherToday },
  // The parent's «today» lives in the dashboard's child card (components/dashboard/core-widgets.tsx).
  { id: "attendance-portions", roles: ["cook"], slot: "main", order: 20, Component: PortionsCard },
];

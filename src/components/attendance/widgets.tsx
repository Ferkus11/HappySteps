import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarOff, CheckCircle2, CircleDashed, ClipboardCheck } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, isWorkingDayDb, loadGroupDay, loadPortions } from "@/lib/attendance";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PortionsCard } from "./portions-card";
import { ReasonIcon } from "./reason";

/** Owner/head top row (and accountant main): present / absent today with a ring (% of active). */
async function AttendanceTodayStat({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const [working, rows] = await Promise.all([isWorkingDayDb(supabase, ctx.kg.id, today), loadPortions(supabase, ctx.kg.id, today)]);
  const active = rows.reduce((s, r) => s + r.active, 0);
  const present = rows.reduce((s, r) => s + (r.present ?? 0), 0);
  const absent = rows.reduce((s, r) => s + r.absent, 0);
  const unmarkedGroups = rows.filter((r) => r.active > 0 && r.unmarked > 0).length;
  return (
    <Link href="/attendance" className="block h-full">
      <Card className="flex h-full items-center justify-between gap-3 hover:shadow-md">
        <Stat
          value={<span data-testid="dash-attendance-present">{working ? present : "—"}</span>}
          label={t("todayCard")}
          sub={
            !working ? (
              t("dayOff")
            ) : (
              <span data-testid="dash-attendance-absent">
                {t("absentToday", { count: absent })}
                {unmarkedGroups ? ` · ${t("groupsUnmarked", { count: unmarkedGroups })}` : ""}
              </span>
            )
          }
        />
        {working ? <Ring value={active ? (present / active) * 100 : 0} color="var(--success)" /> : null}
      </Card>
    </Link>
  );
}

/** Teacher: "Моя группа сегодня" — marked or not, who won't come and why, "Отметить". */
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
  const days = await Promise.all(groups.map((g) => loadGroupDay(supabase, g.id, today)));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g, i) => {
        const list = days[i];
        const marked = list.filter((c) => c.effective.status !== "none").length;
        const present = list.filter((c) => c.effective.status === "present").length;
        const done = list.length > 0 && marked === list.length;
        const away = list.filter((c) => c.effective.status === "absent");
        return (
          <Card key={g.id} data-testid="teacher-today">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
                  {t("myGroupToday")} · {g.name}
                </span>
              }
            />
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
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-faint">{t("wontCome")}</div>
                <ul className="space-y-1.5">
                  {away.map((c) => {
                    const reason = c.effective.status === "absent" ? c.effective.reason : null;
                    return (
                      <li key={c.id} className="flex items-center gap-2 text-sm" data-testid="teacher-today-absent">
                        <span className="text-tile-absent-fg">
                          <ReasonIcon reason={reason} />
                        </span>
                        <span className="min-w-0 truncate font-semibold">{c.name}</span>
                        <span className="shrink-0 text-muted">{reason ? t(`reasons.${reason}`) : t("absent")}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <Button asChild size="lg" variant={done ? "outline" : "primary"} className="mt-4 w-full">
              <Link href={`/attendance?group=${g.id}`} data-testid="teacher-mark">
                <ClipboardCheck /> {done ? t("open") : t("mark")}
              </Link>
            </Button>
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

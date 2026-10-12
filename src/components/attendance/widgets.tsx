import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarOff, CheckCircle2, CircleDashed, ClipboardCheck, Sun } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, isWorkingDayDb, loadGroupDay, loadPortions } from "@/lib/attendance";
import { effectiveStatus, reportCovering, type AbsenceReport, type AttendanceRow } from "@/lib/attendance-logic";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { PortionsCard } from "./portions-card";
import { ReportAbsenceButton } from "./absence-dialog";
import { AbsenceList } from "./absence-list";
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

/** Own active children (kept local to avoid an import cycle with the dashboard). */
async function myKids(ctx: KgContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("child_guardians")
    .select("children!inner(id, full_name, status)")
    .eq("user_id", ctx.userId)
    .eq("kindergarten_id", ctx.kg.id)
    .eq("children.status", "active");
  return ((data ?? []) as unknown as { children: { id: string; full_name: string } }[])
    .map((r) => r.children)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
}

/** Parent: is my child in the kindergarten today + "Ребёнок не придёт" + upcoming reports. */
async function ParentToday({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("attendance");
  const kids = await myKids(ctx);
  if (!kids.length) return null;
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const ids = kids.map((k) => k.id);
  const [working, { data: rows }, { data: reports }] = await Promise.all([
    isWorkingDayDb(supabase, ctx.kg.id, today),
    supabase.from("child_attendance").select("child_id, date, status, reason").in("child_id", ids).eq("date", today),
    supabase
      .from("absence_reports")
      .select("id, child_id, date_from, date_to, reason, comment")
      .in("child_id", ids)
      .is("cancelled_at", null)
      .gte("date_to", today)
      .order("date_from"),
  ]);
  const reps = (reports ?? []) as AbsenceReport[];
  const rowBy = new Map(((rows ?? []) as AttendanceRow[]).map((r) => [r.child_id, r]));
  const name = (id: string) => kids.find((k) => k.id === id)?.full_name.split(" ").slice(1, 2).join(" ") || kids.find((k) => k.id === id)?.full_name;
  return (
    <Card data-testid="parent-today">
      <CardHeader title={t("todayInKg")} />
      <ul className="space-y-2.5">
        {kids.map((k) => {
          const e = effectiveStatus(rowBy.get(k.id), reportCovering(reps, k.id, today));
          const tone = !working ? "off" : e.status;
          return (
            <li
              key={k.id}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3",
                tone === "present" && "bg-tile-work",
                tone === "absent" && "bg-tile-absent",
                tone === "none" && "bg-tile-unmarked",
                tone === "off" && "bg-surface-muted",
              )}
            >
              <Avatar name={k.full_name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-muted">{k.full_name}</div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-[17px] font-extrabold",
                    tone === "present" && "text-tile-work-fg",
                    tone === "absent" && "text-tile-absent-fg",
                    tone === "none" && "text-tile-unmarked-fg",
                  )}
                  data-testid="child-today-status"
                  data-status={tone}
                >
                  {tone === "off" ? (
                    <>
                      <Sun className="size-4" aria-hidden /> {t("dayOffToday")}
                    </>
                  ) : tone === "present" ? (
                    t("inKgToday")
                  ) : tone === "absent" ? (
                    t("notInKgToday")
                  ) : (
                    t("notMarkedYet")
                  )}
                </div>
                {e.status === "absent" && e.reason ? <div className="text-xs font-semibold text-tile-absent-fg/80">{t(`reasons.${e.reason}`)}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ReportAbsenceButton
        kids={kids.map((k) => ({ id: k.id, name: k.full_name }))}
        today={today}
        variant="primary"
        className="mt-4 h-14 w-full rounded-2xl text-base sm:w-auto sm:px-8"
      />
      {reps.length ? (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-faint">{t("reportedAbsences")}</div>
          <AbsenceList today={today} items={reps.map((r) => ({ ...r, childName: kids.length > 1 ? name(r.child_id) : undefined }))} />
        </div>
      ) : null}
    </Card>
  );
}

export const attendanceWidgets: DashboardWidget[] = [
  { id: "attendance-today", roles: ["owner", "head"], slot: "stat", order: 10, Component: AttendanceTodayStat },
  { id: "attendance-today-accountant", roles: ["accountant"], slot: "main", order: 10, Component: AttendanceTodayStat },
  { id: "attendance-teacher", roles: ["teacher"], slot: "top", order: 20, Component: TeacherToday },
  { id: "attendance-parent", roles: ["parent"], slot: "top", order: 10, Component: ParentToday },
  { id: "attendance-portions", roles: ["cook", "owner", "head"], slot: "main", order: 20, Component: PortionsCard },
];

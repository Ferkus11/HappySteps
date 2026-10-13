import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarOff, ChevronLeft, ChevronRight, ClipboardCheck, Lock, Table2, UsersRound } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, isAdminRole, isWorkingDayDb, loadGroupDay } from "@/lib/attendance";
import { isDate } from "@/lib/attendance-logic";
import { addDays, formatDate, isoWeekday, todayIn } from "@/lib/format";
import { signedUrls } from "@/lib/kg-assets";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Marking } from "./marking";

export async function generateMetadata() {
  return { title: (await getTranslations("attendance"))("title") };
}

type SP = Promise<{ group?: string; date?: string }>;

export default async function AttendancePage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher"]);
  const sp = await searchParams;
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const date = isDate(sp.date) && sp.date <= today ? sp.date : today;
  const groups = await attendanceGroups(supabase, ctx);
  const admin = isAdminRole(ctx);

  const header = (
    <PageHeader
      title={t("title")}
      description={t("subtitle")}
      actions={
        groups.length ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/attendance/report${sp.group ? `?group=${sp.group}` : ""}`} data-testid="attendance-report-link">
              <Table2 /> {t("monthReport")}
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (!groups.length) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={UsersRound} title={t("noGroups")} hint={ctx.role === "teacher" ? t("noGroupsTeacher") : t("noGroupsHint")} />
        </Card>
      </>
    );
  }

  const group = sp.group ? groups.find((g) => g.id === sp.group) : groups[0];
  if (!group) {
    return (
      <>
        {header}
        <Card data-testid="attendance-forbidden">
          <EmptyState icon={Lock} title={t("groupForbidden")} hint={t("groupForbiddenHint")} action={<Button asChild variant="outline"><Link href="/attendance">{t("backToMine")}</Link></Button>} />
        </Card>
      </>
    );
  }

  const working = await isWorkingDayDb(supabase, ctx.kg.id, date);
  const editable = (admin || (ctx.role === "teacher" && date === today)) && working;
  const day = working ? await loadGroupDay(supabase, group.id, date) : [];
  const photos = await signedUrls("child-photos", day.map((c) => c.photoPath ?? "").filter(Boolean));
  const href = (g: string, d: string) => `/attendance?group=${g}${d !== today ? `&date=${d}` : ""}`;
  const weekday = t(`weekdays.${isoWeekday(date)}` as "weekdays.1");

  return (
    <>
      {header}
      {groups.length > 1 ? (
        <nav className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label={t("groups")} data-testid="group-switcher">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={href(g.id, date)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                g.id === group.id ? "border-text bg-text text-surface" : "border-border bg-surface text-text hover:bg-surface-muted",
              )}
              aria-current={g.id === group.id ? "page" : undefined}
            >
              <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              <span data-user-content>{g.name}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <Link href={href(group.id, addDays(date, -1))} className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-surface-muted" aria-label={t("prevDay")} data-testid="prev-day">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          {groups.length === 1 ? (
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted">
              <span className="size-2 rounded-full" style={{ background: group.color }} aria-hidden />
              <span data-user-content className="truncate">{group.name}</span>
            </div>
          ) : null}
          <div className="truncate text-[15px] font-bold" data-testid="attendance-date">
            {date === today ? t("today") : weekday}, {formatDate(date)}
          </div>
          {!editable && working ? (
            <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-faint" data-testid="attendance-readonly">
              <Lock className="size-3" aria-hidden /> {ctx.role === "accountant" ? t("viewOnly") : t("pastLocked")}
            </div>
          ) : date !== today ? (
            <Link href={href(group.id, today)} className="text-xs font-semibold text-brand">
              {t("toToday")}
            </Link>
          ) : null}
        </div>
        {date < today ? (
          <Link href={href(group.id, addDays(date, 1))} className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-surface-muted" aria-label={t("nextDay")}>
            <ChevronRight className="size-5" />
          </Link>
        ) : (
          <span className="size-11 shrink-0" aria-hidden />
        )}
      </div>

      {!working ? (
        <Card data-testid="attendance-day-off">
          <EmptyState icon={CalendarOff} title={t("dayOff")} hint={t("dayOffHint")} />
        </Card>
      ) : day.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title={t("noChildren")} hint={t("noChildrenHint")} />
        </Card>
      ) : (
        <Marking
          key={`${group.id}|${date}|${day.map((c) => `${c.id}:${c.effective.status}`).join(",")}`}
          groupId={group.id}
          date={date}
          editable={editable}
          items={day.map((c) => ({
            id: c.id,
            name: c.name,
            photo: c.photoPath ? (photos[c.photoPath] ?? null) : null,
            allergies: c.allergies,
            effective: c.effective,
            report: c.report ? { reason: c.report.reason, comment: c.report.comment, from: c.report.date_from, to: c.report.date_to } : null,
          }))}
        />
      )}
    </>
  );
}

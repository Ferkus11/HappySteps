import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Table2, X } from "lucide-react";
import { requireKg, type KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadDays } from "@/lib/queries/worktime";
import { DAY_STATUSES, formatDuration, formatHours, parseDate, tileCounts, type DayRow, type DayStatus } from "@/lib/worktime";
import { addDays, formatDate, isoWeekday, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkdayCard } from "@/components/worktime/workday-card";
import { WorktimeTiles } from "@/components/worktime/status-tiles";
import { DayMarkers, DayStatusBadge, sessionsText } from "@/components/worktime/day-bits";
import { NavPicker } from "@/components/worktime/nav-pickers";

export async function generateMetadata() {
  return { title: (await getTranslations("worktime"))("title") };
}

const VIEWERS = ["owner", "head", "accountant"] as const;

export default async function WorktimePage({ searchParams }: { searchParams: Promise<{ date?: string; status?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher", "club_teacher", "cook"]);
  const sp = await searchParams;
  if ((VIEWERS as readonly string[]).includes(ctx.role)) return <AdminView ctx={ctx} date={sp.date} status={sp.status} />;
  return <StaffView ctx={ctx} />;
}

const ORDER: Record<DayStatus, number> = { late: 0, unmarked: 1, absent: 2, work: 3, done: 4, upcoming: 5, off: 6 };

async function AdminView({ ctx, date: rawDate, status: rawStatus }: { ctx: KgContext; date?: string; status?: string }) {
  const t = await getTranslations("worktime");
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);
  const date = parseDate(rawDate, today);
  const status = (DAY_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as DayStatus) : null;
  const supabase = await createClient();
  const rows = await loadDays(supabase, ctx.kg.id, date, date);
  const shown = rows
    .filter((r) => !r.archived)
    .filter((r) => !status || r.status === status)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.full_name.localeCompare(b.full_name, "ru"));
  const q = (d: string, s?: string | null) => `/worktime?date=${d}${s ? `&status=${s}` : ""}`;
  const canEdit = ctx.role === "owner" || ctx.role === "head";

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitleAdmin")}
        actions={
          <Button asChild variant="secondary">
            <Link href="/worktime/timesheet" data-testid="open-timesheet">
              <Table2 /> {t("timesheet")}
            </Link>
          </Button>
        }
      />
      <div className="mb-4 empty:hidden">
        <WorkdayCard ctx={ctx} />
      </div>
      <Card className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={t("prevDay")}>
            <Link href={q(addDays(date, -1), status)}>
              <ChevronLeft />
            </Link>
          </Button>
          <NavPicker value={date} param="date" path="/worktime" label={t("date")} />
          <Button asChild variant="outline" size="icon" aria-label={t("nextDay")}>
            <Link href={q(addDays(date, 1), status)}>
              <ChevronRight />
            </Link>
          </Button>
          {date !== today ? (
            <Button asChild variant="ghost">
              <Link href="/worktime">{t("today")}</Link>
            </Button>
          ) : null}
          <span className="basis-full text-sm font-semibold text-muted sm:ml-auto sm:basis-auto" data-testid="worktime-date">
            {date === today ? t("todayIs", { date: formatDate(date) }) : formatDate(date)}
          </span>
        </div>
        <WorktimeTiles counts={tileCounts(rows.filter((r) => !r.archived))} href={(s) => q(date, s === status ? null : s)} />
      </Card>
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 md:px-5">
          <h2 className="text-[15px] font-bold">{t("people")}</h2>
          {status ? (
            <Link href={q(date)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
              {t(`status.${status}`)} <X className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={Clock} title={t("emptyDay")} hint={t("emptyDayHint")} />
        ) : (
          <ul className="mt-2 divide-y divide-border" data-testid="worktime-list">
            {shown.map((r) => (
              <PersonDay key={r.user_id} row={r} tz={tz} href={`/worktime/people/${r.user_id}?month=${date.slice(0, 7)}`} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

async function PersonDay({ row, tz, href, canEdit }: { row: DayRow; tz: string; href: string; canEdit: boolean }) {
  const t = await getTranslations("worktime");
  const shift = row.shift_start && row.shift_end ? `${row.shift_start}–${row.shift_end}` : null;
  return (
    <li>
      <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5" data-testid={`wt-row-${row.user_id}`} title={canEdit ? t("openPerson") : undefined}>
        <Avatar name={row.full_name} />
        <div className="min-w-0 flex-1">
          <div data-user-content className="line-clamp-2 font-bold break-words">{row.full_name}</div>
          <div className="mt-0.5 text-sm text-muted">
            {shift ? t("shiftShort", { time: shift }) : t("noShift")}
            {row.sessions.length ? <span className="text-text"> · {sessionsText(row, tz)}</span> : null}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
            <DayMarkers row={row} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <DayStatusBadge row={row} />
          {row.worked_minutes > 0 ? <span className="text-sm font-bold tabular-nums">{formatDuration(row.worked_minutes)}</span> : null}
        </div>
      </Link>
    </li>
  );
}

async function StaffView({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("worktime");
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);
  const supabase = await createClient();
  const from = addDays(today, -20);
  const rows = (await loadDays(supabase, ctx.kg.id, from, today)).filter((r) => r.user_id === ctx.userId);
  const monthRows = rows.filter((r) => r.work_date.startsWith(today.slice(0, 7)));
  const recent = [...rows].reverse().filter((r) => r.status !== "off" || r.sessions.length);
  const monthMinutes = monthRows.reduce((s, r) => s + r.worked_minutes, 0);
  const lates = monthRows.filter((r) => r.status === "late").length;
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitleStaff")} />
      <div className="mb-4">
        <WorkdayCard ctx={ctx} ownerNeedsSchedule={false} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <div className="text-[28px] leading-none font-extrabold tabular-nums" data-testid="my-month-hours">
            {formatHours(monthMinutes)}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{t("hoursThisMonth")}</div>
        </Card>
        <Card>
          <div className="text-[28px] leading-none font-extrabold tabular-nums">{lates}</div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{t("latesThisMonth")}</div>
        </Card>
      </div>
      <Card className="p-0">
        <CardHeader title={t("myDays")} className="mb-0 px-4 pt-4 md:px-5" />
        {recent.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t("noDays")} hint={t("noDaysHint")} />
        ) : (
          <ul className="mt-2 divide-y divide-border" data-testid="my-days">
            {recent.map((r) => (
              <li key={r.work_date} className="flex min-h-14 items-center gap-3 px-4 py-2.5 md:px-5">
                <div className="w-24 shrink-0">
                  <div className="text-sm font-bold">{formatDate(r.work_date).slice(0, 5)}</div>
                  <div className="text-xs text-faint">{t(`weekdays.${isoWeekday(r.work_date)}`)}</div>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate">{r.sessions.length ? sessionsText(r, tz) : r.shift_start ? `${r.shift_start}–${r.shift_end}` : "—"}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
                    <DayMarkers row={r} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <DayStatusBadge row={r} />
                  {r.worked_minutes > 0 ? <span className="text-sm font-bold tabular-nums">{formatDuration(r.worked_minutes)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

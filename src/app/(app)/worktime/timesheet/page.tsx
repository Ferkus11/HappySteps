import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheet, FileText, Pencil, Table2 } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadDays } from "@/lib/queries/worktime";
import { buildTimesheet, cellKind, formatHours, monthDays, parseMonth, shiftMonth, type DayRow } from "@/lib/worktime";
import { isoWeekday, monthRange, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MonthStepper } from "@/components/ui/month-stepper";

export async function generateMetadata() {
  return { title: (await getTranslations("worktime"))("timesheet") };
}

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant"]);
  const sp = await searchParams;
  const t = await getTranslations("worktime");
  const today = todayIn(ctx.settings.timezone);
  const month = parseMonth(sp.month, today);
  const { from, to } = monthRange(month);
  const supabase = await createClient();
  const people = buildTimesheet(await loadDays(supabase, ctx.kg.id, from, to));
  const days = monthDays(month);
  const canEdit = ctx.role === "owner" || ctx.role === "head";
  const sum = people.reduce(
    (s, p) => ({ minutes: s.minutes + p.totals.minutes, lates: s.lates + p.totals.lates, missed: s.missed + p.totals.missed + p.totals.absences }),
    { minutes: 0, lates: 0, missed: 0 },
  );
  const [y, m] = month.split("-");

  return (
    <>
      <PageHeader
        title={t("timesheet")}
        description={t("timesheetFor", { month: t(`months.${Number(m)}`), year: y })}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/worktime/timesheet/export?month=${month}&format=xlsx`} data-testid="export-xlsx" download>
                <FileSpreadsheet /> .xlsx
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`/worktime/timesheet/export?month=${month}&format=pdf`} data-testid="export-pdf" download>
                <FileText /> PDF
              </a>
            </Button>
          </>
        }
      />
      <MonthStepper
        className="mb-4"
        label={t("timesheetFor", { month: t(`months.${Number(m)}`), year: y })}
        prevHref={`/worktime/timesheet?month=${shiftMonth(month, -1)}`}
        nextHref={`/worktime/timesheet?month=${shiftMonth(month, 1)}`}
        prevLabel={t("prevMonth")}
        nextLabel={t("nextMonth")}
        testId="ts"
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold tabular-nums md:text-[28px]" data-testid="ts-total-hours">
            {formatHours(sum.minutes)}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{t("totals.hoursAll")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold tabular-nums md:text-[28px]">{sum.lates}</div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{t("totals.lates")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold tabular-nums md:text-[28px]">{sum.missed}</div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{t("totals.missed")}</div>
        </Card>
      </div>
      {people.length === 0 ? (
        <Card>
          <EmptyState icon={Table2} title={t("emptyTimesheet")} hint={t("emptyTimesheetHint")} />
        </Card>
      ) : (
        <Card className="min-w-0 p-0">
          {/* desktop: short names and 24px day cells, so all 31 days and the month totals fit 1440 without scrolling;
              when they do not (tablets, phones) the edge shadow shows there is more to the right */}
          <div className="scroll-shadow-x overflow-x-auto" data-testid="timesheet-scroll">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]" data-testid="timesheet">
              <thead>
                <tr className="text-faint">
                  <th className="sticky left-0 z-10 min-w-40 border-b border-border bg-surface px-3 py-2 text-left text-[12px] font-semibold md:min-w-0 md:px-2">{t("employee")}</th>
                  {days.map((d) => {
                    const wd = isoWeekday(d);
                    return (
                      <th key={d} className={cn("min-w-8 border-b border-border px-0.5 py-2 text-center font-semibold md:w-6 md:min-w-6 md:px-0", wd > 5 && "text-brand", d === today && "text-brand")}>
                        <div className="text-text">{Number(d.slice(8))}</div>
                        <div className="text-[10px] font-medium">{t(`weekdays.${wd}`)}</div>
                      </th>
                    );
                  })}
                  <th className="border-b border-l border-border px-2 py-2 text-right font-semibold md:px-1.5">{t("totals.hoursShort")}</th>
                  <th className="border-b border-border px-2 py-2 text-right font-semibold md:px-1.5">{t("totals.latesShort")}</th>
                  <th className="border-b border-border px-2 py-2 text-right font-semibold md:px-1.5">{t("totals.absencesShort")}</th>
                  <th className="border-b border-border px-2 py-2 text-right font-semibold md:px-1.5">{t("totals.missedShort")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.userId} data-testid={`ts-row-${p.userId}`}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-1.5 text-left font-semibold md:px-2">
                      <div className="flex items-center gap-1">
                        <Link href={`/worktime/people/${p.userId}?month=${month}`} className="max-w-36 truncate whitespace-nowrap hover:text-brand pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center" title={p.fullName}>
                          <span className="truncate md:hidden" data-user-content>
                            {p.fullName}
                          </span>
                          <span className="hidden md:inline" data-user-content>
                            {shortName(p.fullName)}
                          </span>
                        </Link>
                        {canEdit ? (
                          <Link
                            href={`/worktime/people/${p.userId}?month=${month}`}
                            className="grid size-8 pointer-coarse:size-11 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-muted hover:text-brand"
                            aria-label={t("editPerson")}
                            data-testid="ts-edit"
                          >
                            <Pencil className="size-3.5" />
                          </Link>
                        ) : null}
                      </div>
                      {p.archived ? (
                        <Badge tone="neutral" className="mt-0.5 px-1.5 py-0 text-[10px]">
                          {t("archived")}
                        </Badge>
                      ) : null}
                    </th>
                    {days.map((d) => (
                      <Cell key={d} row={p.days[d]} t={t} />
                    ))}
                    <td className="border-b border-l border-border px-2 text-right font-bold tabular-nums md:px-1.5" data-testid="ts-hours">
                      {formatHours(p.totals.minutes)}
                    </td>
                    <td className="border-b border-border px-2 text-right tabular-nums md:px-1.5">{p.totals.lates || "—"}</td>
                    <td className="border-b border-border px-2 text-right tabular-nums md:px-1.5">{p.totals.absences || "—"}</td>
                    <td className="border-b border-border px-2 text-right tabular-nums md:px-1.5">{p.totals.missed || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card className="mt-4">
        <h2 className="mb-3 text-[15px] font-bold">{t("legend")}</h2>
        <ul className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Legend swatch="bg-surface" text="8,5" label={t("legendHours")} />
          <Legend swatch="bg-tile-late text-tile-late-fg" text="8,5" label={t("legendLate")} />
          <Legend swatch="bg-tile-absent text-tile-absent-fg" text={t("codes.sick")} label={t("absence.sick")} />
          <Legend swatch="bg-tile-absent text-tile-absent-fg" text={t("codes.vacation")} label={t("absence.vacation")} />
          <Legend swatch="bg-tile-absent text-tile-absent-fg" text={t("codes.day_off")} label={t("absence.day_off")} />
          <Legend swatch="bg-tile-absent text-tile-absent-fg" text={t("codes.unexcused")} label={t("absence.unexcused")} />
          <Legend swatch="bg-tile-unmarked text-tile-unmarked-fg" text={t("codes.unmarked")} label={t("status.unmarked")} />
          <Legend swatch="bg-surface-muted text-faint" text={t("codes.holiday")} label={t("legendOff")} />
          <Legend swatch="bg-surface" text="8,5*" label={t("legendEdited")} />
          <Legend swatch="bg-surface" text="8,5°" label={t("legendAuto")} />
        </ul>
      </Card>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"worktime">>>;

/** «Нурланова Асель Ериковна» → «Нурланова А.» for the desktop grid (the full name is in the tooltip and on phones). */
function shortName(full: string) {
  const [last, first] = full.trim().split(/\s+/);
  return first ? `${last} ${first[0]}.` : last;
}

function Cell({ row, t }: { row: DayRow | undefined; t: T }) {
  const kind = cellKind(row);
  const base = "h-10 border-b border-border px-0.5 text-center tabular-nums md:px-0 md:text-[11px]";
  if (!row || kind === "empty") return <td className={base} />;
  if (kind === "hours") {
    const late = row.status === "late";
    return (
      <td className={cn(base, "font-semibold", late && "bg-tile-late text-tile-late-fg", row.outside_schedule && "text-tile-unmarked-fg")} title={late ? t("lateBy", { count: row.late_minutes }) : undefined}>
        {formatHours(row.worked_minutes)}
        {row.edited ? <span className="text-sky-strong" data-testid="ts-edited">*</span> : null}
        {row.auto_closed ? <span className="text-warning" data-testid="ts-auto">°</span> : null}
      </td>
    );
  }
  if (kind === "absence") return <td className={cn(base, "bg-tile-absent font-bold text-tile-absent-fg")}>{t(`codes.${row.absence_kind ?? "unexcused"}`)}</td>;
  if (kind === "unmarked") return <td className={cn(base, "bg-tile-unmarked font-bold text-tile-unmarked-fg")}>{t("codes.unmarked")}</td>;
  return <td className={cn(base, "bg-surface-muted text-faint")}>{kind === "holiday" ? t("codes.holiday") : ""}</td>;
}

function Legend({ swatch, text, label }: { swatch: string; text: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn("grid h-7 min-w-10 place-items-center rounded-md border border-border px-1 text-[12px] font-bold", swatch)}>{text}</span>
      <span className="text-muted">{label}</span>
    </li>
  );
}

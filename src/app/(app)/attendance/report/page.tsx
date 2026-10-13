import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download, Lock, Table2, UsersRound } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, isAdminRole, loadMonthGrid } from "@/lib/attendance";
import { isMonth, monthOf, shiftMonth, type Cell } from "@/lib/attendance-logic";
import { todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("attendance"))("reportTitle") };
}

type SP = Promise<{ group?: string; month?: string }>;

export default async function AttendanceReportPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher"]);
  const sp = await searchParams;
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const month = isMonth(sp.month) ? sp.month : monthOf(today);
  const groups = await attendanceGroups(supabase, ctx);
  const group = sp.group ? groups.find((g) => g.id === sp.group) : groups[0];
  const header = <PageHeader title={t("reportTitle")} description={t("reportSubtitle")} />;
  if (!groups.length || !group) {
    return (
      <>
        {header}
        <Card data-testid={groups.length ? "attendance-forbidden" : undefined}>
          {groups.length ? <EmptyState icon={Lock} title={t("groupForbidden")} hint={t("groupForbiddenHint")} /> : <EmptyState icon={UsersRound} title={t("noGroups")} />}
        </Card>
      </>
    );
  }
  const grid = await loadMonthGrid(supabase, ctx.kg.id, group.id, month, today);
  const admin = isAdminRole(ctx);
  const href = (g: string, m: string) => `/attendance/report?group=${g}&month=${m}`;
  const [y, m] = month.split("-");
  const monthName = `${t(`months.${Number(m)}` as "months.1")} ${y}`;
  const workingDays = grid.days.filter((d) => d.working && d.date <= today).length;
  const rate = grid.totalPresent + grid.totalAbsent ? Math.round((grid.totalPresent / (grid.totalPresent + grid.totalAbsent)) * 100) : null;

  return (
    <>
      {header}
      {groups.length > 1 ? (
        <nav className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label={t("groups")}>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={href(g.id, month)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                g.id === group.id ? "border-text bg-text text-surface" : "border-border bg-surface text-text hover:bg-surface-muted",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              <span data-user-content>{g.name}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={href(group.id, shiftMonth(month, -1))} className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-surface-muted" aria-label={t("prevMonth")}>
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-36 text-center text-[15px] font-bold" data-testid="report-month">
          {monthName}
        </div>
        <Link href={href(group.id, shiftMonth(month, 1))} className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted hover:bg-surface-muted" aria-label={t("nextMonth")}>
          <ChevronRight className="size-5" />
        </Link>
        <div className="ml-auto">
          <Button asChild variant="outline">
            <a href={`/attendance/export?group=${group.id}&month=${month}`} data-testid="attendance-export" download>
              <Download /> {t("exportXlsx")}
            </a>
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold">{rate === null ? "—" : `${rate}%`}</div>
          <div className="mt-1.5 text-xs text-muted">{t("rate")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold text-success">{grid.totalPresent}</div>
          <div className="mt-1.5 text-xs text-muted">{t("childDaysPresent")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[24px] leading-none font-extrabold">{workingDays}</div>
          <div className="mt-1.5 text-xs text-muted">{t("workingDays")}</div>
        </Card>
      </div>

      {grid.rows.length === 0 ? (
        <Card>
          <EmptyState icon={Table2} title={t("reportEmpty")} />
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto" data-testid="attendance-grid">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 border-b border-border bg-surface px-3 py-3 text-left text-xs font-semibold text-faint md:px-4">{t("child")}</th>
                  {grid.days.map((d) => (
                    <th key={d.date} className={cn("w-7 border-b border-border px-0 py-2 text-center font-semibold pointer-coarse:w-11", d.working ? "text-muted" : "font-normal text-faint", d.date === today && "text-brand")}>
                      {admin && d.working && d.date <= today ? (
                        <Link href={`/attendance?group=${group.id}&date=${d.date}`} className="block rounded-md hover:bg-surface-muted pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:flex-col pointer-coarse:justify-center">
                          <DayHead d={d.date} wd={t(`weekdaysShort.${d.weekday}` as "weekdaysShort.1")} />
                        </Link>
                      ) : (
                        <DayHead d={d.date} wd={t(`weekdaysShort.${d.weekday}` as "weekdaysShort.1")} />
                      )}
                    </th>
                  ))}
                  <th className="border-b border-border px-2 py-2 text-center text-xs font-semibold text-success">{t("presentShort")}</th>
                  <th className="border-b border-border px-2 py-2 text-center text-xs font-semibold text-tile-absent-fg">{t("absentShort")}</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.childId} data-testid="report-row">
                    <th scope="row" className="sticky left-0 z-10 max-w-44 truncate border-b border-border bg-surface px-3 py-1.5 text-left font-semibold md:px-4" title={r.name} data-user-content>
                      {r.name.split(" ").slice(0, 2).join(" ")}
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} className="border-b border-border px-0 py-1 text-center">
                        <CellMark c={c} letters={{ sick: t("letters.sick"), vacation: t("letters.vacation"), family: t("letters.family"), other: t("letters.other"), none: t("letters.none") }} />
                      </td>
                    ))}
                    <td className="border-b border-border px-3 text-center font-bold text-success">{r.present}</td>
                    <td className="border-b border-border px-3 text-center font-bold text-tile-absent-fg">{r.absent}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-semibold text-faint md:px-4">{t("presentPerDay")}</th>
                  {grid.presentPerDay.map((n, i) => (
                    <td key={i} className="px-0 py-2 text-center text-xs font-bold text-muted">
                      {grid.days[i].working && grid.days[i].date <= today ? n : ""}
                    </td>
                  ))}
                  <td className="px-3 text-center font-extrabold text-success">{grid.totalPresent}</td>
                  <td className="px-3 text-center font-extrabold text-tile-absent-fg">{grid.totalAbsent}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
        <li className="flex items-center gap-1.5"><CellMark c={{ kind: "present" }} letters={null} /> {t("present")}</li>
        {(["sick", "vacation", "family", "other"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <CellMark c={{ kind: "absent", reason: k }} letters={{ sick: t("letters.sick"), vacation: t("letters.vacation"), family: t("letters.family"), other: t("letters.other"), none: t("letters.none") }} /> {t(`reasons.${k}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5"><CellMark c={{ kind: "absent", reason: null }} letters={{ sick: "", vacation: "", family: "", other: "", none: t("letters.none") }} /> {t("absentNoReason")}</li>
        <li className="flex items-center gap-1.5"><CellMark c={{ kind: "none" }} letters={null} /> {t("notMarked")}</li>
        <li className="flex items-center gap-1.5"><CellMark c={{ kind: "off" }} letters={null} /> {t("dayOffShort")}</li>
      </ul>
    </>
  );
}

function DayHead({ d, wd }: { d: string; wd: string }) {
  return (
    <>
      <div className="text-[10px] font-medium uppercase">{wd}</div>
      <div>{Number(d.slice(8))}</div>
    </>
  );
}

type Letters = Record<"sick" | "vacation" | "family" | "other" | "none", string> | null;

function CellMark({ c, letters }: { c: Cell; letters: Letters }) {
  const base = "mx-auto grid size-6 place-items-center rounded-md text-[11px] font-extrabold";
  switch (c.kind) {
    case "present":
      return <span className={cn(base, "bg-success-soft text-success")} data-cell="present">✓</span>;
    case "absent":
      return (
        <span className={cn(base, "bg-tile-absent text-tile-absent-fg")} data-cell="absent">
          {letters ? letters[c.reason ?? "none"] : ""}
        </span>
      );
    case "none":
      return <span className={cn(base, "bg-tile-unmarked text-tile-unmarked-fg")} data-cell="none">·</span>;
    case "off":
      return <span className={cn(base, "border border-border/70 bg-surface-muted")} data-cell="off" />;
    default:
      return <span className={cn(base)} />;
  }
}

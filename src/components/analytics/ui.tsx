import * as React from "react";
import Link from "next/link";
import { BarChart3, ChevronLeft, ChevronRight, Download, type LucideIcon } from "lucide-react";
import { MAX_CUSTOM_DAYS, PERIOD_KINDS, calendarPeriod, periodQuery, shiftPeriod, type Change, type Period, type PeriodProblem, type Section } from "@/lib/analytics";
import { changeTone, formatCell, type ChangeTone, type Column, type DataTable, type T } from "@/lib/analytics-view";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** First-column values that are user content (names) — not translated. */
const USER_COLUMNS = ["group", "employee", "child"];

export function analyticsHref(tab: Section, p: Period): string {
  return `/analytics?${new URLSearchParams({ tab, ...periodQuery(p) }).toString()}`;
}

export function exportHref(section: Section, table: string, p: Period): string {
  return `/analytics/export?${new URLSearchParams({ section, table, ...periodQuery(p) }).toString()}`;
}

// ───────────────────────────── Tabs ─────────────────────────────
export function SectionTabs({ t, tabs, active, period }: { t: T; tabs: Section[]; active: Section; period: Period }) {
  if (tabs.length < 2) return null;
  return (
    <nav
      className="scrollbar-none scroll-shadow-x mb-4 flex w-full gap-1 overflow-x-auto rounded-2xl p-1 [--fade-bg:var(--surface-muted)] sm:inline-flex sm:w-auto sm:max-w-full"
      aria-label={t("title")}
    >
      {tabs.map((k) => (
        <Link
          key={k}
          href={analyticsHref(k, period)}
          aria-current={active === k ? "page" : undefined}
          data-testid={`analytics-tab-${k}`}
          className={cn(
            // phones: 13px and tight padding so the four tabs fit 358px with air on both sides (ru «Посещаемость» is long)
            "inline-flex h-11 shrink-0 grow items-center justify-center rounded-xl px-2 text-[13px] font-semibold whitespace-nowrap text-muted sm:h-10 sm:grow-0 sm:px-4 sm:text-sm",
            active === k && "bg-surface text-text shadow-sm",
          )}
        >
          {t(`tabs.${k}`)}
        </Link>
      ))}
    </nav>
  );
}

// ───────────────────────────── Period picker ─────────────────────────────
/**
 * Kind (week … year, custom) as links, ‹ label › to step, and a plain GET form for a custom range — works
 * without client JavaScript. The label is what the period is called on the page.
 */
export function PeriodPicker({
  t,
  tab,
  period,
  label,
  today,
  problem = null,
}: {
  t: T;
  tab: Section;
  period: Period;
  label: string;
  today: string;
  /** a custom range from the URL could not be used — say why instead of silently showing the current month */
  problem?: PeriodProblem | null;
}) {
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  return (
    <Card className="mb-4 p-3 sm:p-4" data-testid="period-picker">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1" role="group" aria-label={t("period.kinds.custom")}>
          {PERIOD_KINDS.map((k) => {
            const anchor = today >= period.from && today <= period.to ? today : period.from;
            const target: Period = k === "custom" ? { kind: "custom", from: period.from, to: period.to } : calendarPeriod(k, anchor);
            return (
              <Link
                key={k}
                href={analyticsHref(tab, target)}
                aria-current={period.kind === k ? "true" : undefined}
                data-testid={`period-${k}`}
                className={cn(
                  "inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap text-muted sm:h-9 sm:px-3",
                  period.kind === k && "bg-surface text-text shadow-sm",
                )}
              >
                {t(`period.kinds.${k}`)}
              </Link>
            );
          })}
        </div>
        {period.kind === "custom" ? (
          <form action="/analytics" method="get" className="flex flex-wrap items-end gap-2 lg:ml-auto" data-testid="custom-range">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="p" value="custom" />
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="mb-1 block text-xs font-semibold text-muted">{t("period.from")}</span>
              <Input type="date" name="from" defaultValue={period.from} required className="sm:w-40" data-testid="custom-from" />
            </label>
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="mb-1 block text-xs font-semibold text-muted">{t("period.to")}</span>
              <Input type="date" name="to" defaultValue={period.to} required className="sm:w-40" data-testid="custom-to" />
            </label>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto" data-testid="custom-apply">
              {t("period.apply")}
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2 lg:ml-auto">
            <Button asChild variant="outline" size="icon" aria-label={t("period.prev")}>
              <Link href={analyticsHref(tab, prev)} data-testid="period-prev">
                <ChevronLeft />
              </Link>
            </Button>
            <div className="min-w-0 flex-1 text-center text-[15px] font-bold lg:min-w-44" data-testid="period-label">
              {label}
            </div>
            <Button asChild variant="outline" size="icon" aria-label={t("period.next")}>
              <Link href={analyticsHref(tab, next)} data-testid="period-next">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        )}
      </div>
      {problem ? (
        <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm font-semibold text-warning" role="status" data-testid="period-problem">
          {t(`period.problems.${problem}`, { max: MAX_CUSTOM_DAYS })}
        </p>
      ) : null}
    </Card>
  );
}

// ───────────────────────────── KPI tiles ─────────────────────────────
export interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  change: Change | null;
  /** «%» for amounts and counts, « п.п.» for rates (percentage points), « дн.» for days */
  unit: string;
  danger?: boolean;
  /**
   * Which direction of change is good news for this KPI — decided per KPI by the section (e.g. attendance «up»,
   * sickness and debt «down»). Omitted = neutral: the change is shown in grey (e.g. charged amount, manual edits).
   */
  better?: "up" | "down";
  /** a bad change of this KPI is about money owed — the only bad trend shown in red (SPEC §8); others are amber */
  debt?: boolean;
  testId?: string;
}

const TONE_CLASS: Record<ChangeTone, string> = { good: "text-success", bad: "text-warning", neutral: "text-muted" };

/**
 * Big number, small caption, ▲▼ change against the previous period. The arrow keeps the direction; the colour says
 * whether it is good (green) or bad (amber; red only for a growing debt), grey when the KPI has no good direction.
 */
export function Kpi({ t, k }: { t: T; k: KpiProps }) {
  const c = k.change;
  const arrow = c ? (c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "=") : "";
  const tone = changeTone(c, k.better);
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-surface p-4 shadow-card" data-testid={k.testId}>
      <div className="text-[13px] font-semibold text-muted">{k.label}</div>
      <div className={cn("mt-1.5 text-[26px] leading-tight font-extrabold tracking-tight tabular-nums", k.danger ? "text-danger" : "text-text")} data-testid={k.testId ? `${k.testId}-value` : undefined}>
        {k.value}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-faint">
        {c ? (
          <span
            className={cn("font-bold tabular-nums", tone === "bad" && k.debt ? "text-danger" : TONE_CLASS[tone])}
            data-testid={k.testId ? `${k.testId}-delta` : undefined}
            data-tone={tone}
          >
            <span aria-hidden>
              {arrow} {c.dir === "same" ? "" : `${c.value}${k.unit}`}
            </span>
            <span className="sr-only">
              {c.dir === "same" ? t("delta.same") : t(`delta.${c.dir}`, { value: c.value, unit: k.unit })}
              {tone !== "neutral" ? ` (${t(tone === "good" ? "kpi.better" : "kpi.worse")})` : ""}
            </span>
          </span>
        ) : null}
        {k.sub ? <span>{k.sub}</span> : null}
      </div>
    </div>
  );
}

export function KpiGrid({ t, items }: { t: T; items: KpiProps[] }) {
  return (
    <div className={cn("mb-4 grid grid-cols-2 gap-2 sm:gap-3", items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
      {items.map((k) => (
        <Kpi key={k.label} t={t} k={k} />
      ))}
    </div>
  );
}

// ───────────────────────────── Chart card + table ─────────────────────────────
export function ChartCard({
  title,
  insight,
  note,
  children,
  table,
  tableOpen = true,
  exportUrl,
  t,
  testId,
  className,
}: {
  title: string;
  insight: React.ReactNode;
  note?: string;
  children?: React.ReactNode;
  table?: DataTable;
  tableOpen?: boolean;
  exportUrl?: string;
  t: T;
  testId?: string;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 p-4 md:p-5", className)} data-testid={testId}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-bold text-text">{title}</h2>
        {exportUrl ? (
          <Button asChild variant="ghost" size="sm" className="-mt-1 -mr-2 shrink-0 text-sky-strong">
            <a href={exportUrl} download data-testid={testId ? `${testId}-export` : undefined} aria-label={`${t("export")}: ${title}`}>
              <Download /> <span className="hidden sm:inline">{t("export")}</span>
              <span className="sm:hidden">{t("exportShort")}</span>
            </a>
          </Button>
        ) : null}
      </div>
      {insight ? (
        <p className="mb-3 text-sm font-semibold text-sky-strong" data-testid={testId ? `${testId}-insight` : undefined}>
          {insight}
        </p>
      ) : null}
      {note ? <p className="-mt-2 mb-3 text-xs text-faint">{note}</p> : null}
      {children}
      {table ? (
        tableOpen ? (
          <div className={cn(children ? "mt-4" : "")}>
            <TableView table={table} />
          </div>
        ) : (
          <details className="group mt-3">
            <summary className="inline-flex h-11 cursor-pointer list-none items-center text-sm font-semibold text-sky-strong sm:h-9">{t("showTable")}</summary>
            <div className="mt-2">
              <TableView table={table} />
            </div>
          </details>
        )
      ) : null}
    </Card>
  );
}

/**
 * Table that scrolls horizontally inside its card only; first column stays readable. On phones the columns marked
 * `phone: "hide"` are left out and `phone: "sub"` ones move under the first cell as a small line, so the key numbers
 * (e.g. the debt) stay on screen at 390px without scrolling.
 */
export function TableView({ table }: { table: DataTable }) {
  const num = (k: string) => k !== "text";
  const phoneHidden = (c: Column) => (c.phone ? "hidden sm:table-cell" : "");
  const subs = table.columns.filter((c) => c.phone === "sub");
  return (
    // scroll-shadow-x: a shadow at the edge while columns are hidden behind it (wide tables on phones and tablets)
    <div className="scroll-shadow-x -mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5" data-testid={`table-${table.id}`} tabIndex={0} role="region" aria-label={table.title}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{table.title}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {table.columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                data-col={c.key}
                // headers wrap at spaces (never inside a word), so a wide table fits the card at 1440 instead of
                // cutting off its last columns; a table that still does not fit scrolls with an edge shadow
                className={cn("px-2 py-2 align-bottom font-semibold first:pl-0 last:pr-0", num(c.kind) && "text-right", i === 0 && "max-w-56", phoneHidden(c))}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {table.rows.map((r, idx) => {
            const subline = subs.map((c) => r[c.key]).filter((v) => v != null && v !== "").join(" · ");
            return (
              <tr key={idx}>
                {table.columns.map((c, i) => (
                  <td
                    key={c.key}
                    data-col={c.key}
                    className={cn(
                      "px-2 py-2 tabular-nums first:pl-0 last:pr-0",
                      i === 0 ? "max-w-44 font-semibold sm:max-w-56" : "whitespace-nowrap",
                      num(c.kind) && "text-right",
                      c.danger && Number(r[c.key] ?? 0) > 0 && "font-bold text-danger",
                      phoneHidden(c),
                    )}
                  >
                    {i === 0 ? (
                      <>
                        <span className="line-clamp-2 break-words" data-user-content={USER_COLUMNS.includes(c.key) ? "" : undefined}>
                          {formatCell(r[c.key] ?? null, c.kind)}
                        </span>
                        {subline ? (
                          <span className="block truncate text-xs font-normal text-muted sm:hidden" data-user-content={subs.some((c) => USER_COLUMNS.includes(c.key)) ? "" : undefined}>
                            {subline}
                          </span>
                        ) : null}
                      </>
                    ) : USER_COLUMNS.includes(c.key) ? (
                      <span data-user-content>{formatCell(r[c.key] ?? null, c.kind)}</span>
                    ) : (
                      formatCell(r[c.key] ?? null, c.kind)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {table.total ? (
          <tfoot>
            <tr className="border-t-2 border-border font-bold" data-testid={`table-${table.id}-total`}>
              {table.columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-2 py-2 whitespace-nowrap tabular-nums first:pl-0 last:pr-0",
                    num(c.kind) && "text-right",
                    c.danger && Number(table.total?.[c.key] ?? 0) > 0 && "text-danger",
                    phoneHidden(c),
                  )}
                  data-col={c.key}
                >
                  {i === 0 ? String(table.total?.[c.key] ?? "") : formatCell(table.total?.[c.key] ?? null, c.kind)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function SectionEmpty({ icon = BarChart3, title, hint, testId }: { icon?: LucideIcon; title: string; hint: string; testId?: string }) {
  return (
    <Card data-testid={testId ?? "analytics-empty"}>
      <EmptyState icon={icon} title={title} hint={hint} />
    </Card>
  );
}

export function ChartEmpty({ text }: { text: string }) {
  return <div className="grid h-24 place-items-center rounded-xl bg-surface-muted text-sm text-faint">{text}</div>;
}

import { CalendarClock } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activeInsight,
  attendanceTotals,
  change,
  churnInsight,
  closedDaysPrev,
  debtorsInsight,
  fillInsight,
  financeTotals,
  funnelInsight,
  funnelTotals,
  groupsInsight,
  hoursInsight,
  paidUntilPrev,
  payDaysInsight,
  pct,
  rateInsight,
  staffInsight,
  staffTotals,
  topAbsenceInsight,
  type Period,
  type Range,
  type Section,
} from "@/lib/analytics";
import { loadAttendance, loadFinance, loadFunnel, loadStaff } from "@/lib/analytics-data";
import { activeSeries, attendanceSeries, buildTables, periodThan, periodWhen, rangeLabel, renderInsight, type T } from "@/lib/analytics-view";
import { formatDate, formatMoney } from "@/lib/format";
import { HBars, HPairBars, MoneyStack, TrendLine } from "./charts";
import { ChartCard, ChartEmpty, KpiGrid, SectionEmpty, exportHref, type KpiProps } from "./ui";

export interface SectionProps {
  supabase: SupabaseClient;
  kgId: string;
  t: T;
  period: Period;
  cur: Range;
  prev: Range;
  today: string;
}

const pctText = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

function phrases(p: SectionProps) {
  return { when: periodWhen(p.t, p.period.kind, p.cur), than: periodThan(p.t, p.period.kind, p.prev) };
}

export async function AnalyticsSection(props: SectionProps & { section: Section }) {
  if (props.cur.from > props.today) {
    return <SectionEmpty icon={CalendarClock} title={props.t("empty.future")} hint={props.t("empty.futureHint")} testId="analytics-future" />;
  }
  switch (props.section) {
    case "attendance":
      return <AttendanceSection {...props} />;
    case "staff":
      return <StaffSection {...props} />;
    case "finance":
      return <FinanceSection {...props} />;
    case "funnel":
      return <FunnelSection {...props} />;
  }
}

// ───────────────────────────── 1. Attendance and occupancy ─────────────────────────────
async function AttendanceSection(p: SectionProps) {
  const { t } = p;
  const [cur, prev] = await Promise.all([loadAttendance(p.supabase, p.kgId, p.cur), loadAttendance(p.supabase, p.kgId, p.prev)]);
  const tc = attendanceTotals(cur.days, cur.groups);
  const tp = attendanceTotals(prev.days, prev.groups);
  if (tc.marked === 0 && tc.children === 0) return <SectionEmpty title={t("empty.title")} hint={t("empty.attendance")} />;
  const ph = phrases(p);
  const pp = t("delta.pp");
  const [days, groups, reasons] = buildTables("attendance", cur, { t, range: p.cur });
  const series = attendanceSeries(cur, p.cur);
  const kpis: KpiProps[] = [
    { label: t("kpi.attendance"), value: pctText(tc.rate), change: change(tc.rate, tp.rate, "points"), unit: pp, testId: "kpi-attendance" },
    { label: t("kpi.fill"), value: pctText(tc.fill), sub: `${tc.children} / ${tc.capacity}`, change: change(tc.fill, tp.fill, "points"), unit: pp, testId: "kpi-fill" },
    { label: t("kpi.sickness"), value: pctText(tc.sickShare), change: change(tc.sickShare, tp.sickShare, "points"), unit: pp, testId: "kpi-sickness" },
    { label: t("kpi.absences"), value: String(tc.absent), sub: t("kpi.absencesSub", { count: tc.absent }), change: change(tc.absent, tp.absent, "relative"), unit: "%", testId: "kpi-absences" },
  ];
  const rated = cur.groups.map((g) => ({ name: g.name, value: pct(g.present, g.present + g.absent) }));
  const fills = cur.groups.map((g) => ({ name: g.name, value: pct(g.children, g.capacity) }));
  const maxFill = Math.max(100, ...fills.map((f) => f.value ?? 0));
  const reasonRows = reasons.rows.map((r) => ({ name: String(r.reason), value: Number(r.count) }));
  return (
    <div className="space-y-4" data-testid="section-attendance">
      <KpiGrid t={t} items={kpis} />
      <ChartCard
        t={t}
        testId="chart-daily"
        title={t("charts.daily")}
        insight={renderInsight(t, rateInsight("attendance", tc.rate, tp.rate), ph)}
        table={days}
        tableOpen={false}
        exportUrl={exportHref("attendance", "days", p.period)}
      >
        {tc.marked ? (
          <TrendLine
            label={t("charts.daily")}
            seriesName={t("series.attendance")}
            percent
            points={series.points.map((x) => ({ label: series.g === "month" ? t(`monthsShort.${Number(x.d.slice(5, 7))}`) : shortDate(x.d), value: x.rate }))}
          />
        ) : (
          <ChartEmpty text={t("empty.chart")} />
        )}
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard t={t} testId="chart-groups" title={t("charts.groups")} insight={renderInsight(t, groupsInsight(cur.groups), ph)}>
          {rated.some((r) => r.value != null) ? <HBars label={t("charts.groups")} seriesName={t("series.attendance")} percent rows={rated} userNames /> : <ChartEmpty text={t("empty.chart")} />}
        </ChartCard>
        <ChartCard
          t={t}
          testId="chart-fill"
          title={t("charts.fill")}
          insight={renderInsight(t, fillInsight(cur.groups), ph)}
          note={t("notes.fill", { date: formatDate(cur.on_date) })}
        >
          {fills.length ? <HBars label={t("charts.fill")} seriesName={t("series.fill")} percent max={maxFill} rows={fills} userNames /> : <ChartEmpty text={t("empty.noGroups")} />}
        </ChartCard>
        <ChartCard
          t={t}
          testId="chart-reasons"
          title={t("charts.reasons")}
          insight={renderInsight(t, rateInsight("sickness", tc.sickShare, tp.sickShare), ph)}
          table={reasons}
          tableOpen={false}
          exportUrl={exportHref("attendance", "reasons", p.period)}
        >
          {reasonRows.length ? <HBars label={t("charts.reasons")} seriesName={t("series.absences")} rows={reasonRows} /> : <ChartEmpty text={t("empty.chart")} />}
        </ChartCard>
      </div>
      {/* full width: nine columns do not fit a half-width card at 1440 */}
      <ChartCard
        t={t}
        testId="chart-top"
        title={t("charts.topAbsences")}
        insight={renderInsight(t, topAbsenceInsight(cur.groups), ph)}
        table={groups}
        exportUrl={exportHref("attendance", "groups", p.period)}
      />
    </div>
  );
}

// ───────────────────────────── 2. Staff discipline ─────────────────────────────
async function StaffSection(p: SectionProps) {
  const { t } = p;
  // closed days only: the previous period gets the same number of closed days (1–12 ↔ 1–12 on the 13th)
  const prevRange = closedDaysPrev(p.period, p.prev, p.today);
  const [cur, prev] = await Promise.all([loadStaff(p.supabase, p.kgId, p.cur), prevRange ? loadStaff(p.supabase, p.kgId, prevRange) : Promise.resolve([])]);
  if (!cur.length) return <SectionEmpty title={t("empty.title")} hint={`${t("empty.staff")} ${t("notes.staff")}`} />;
  const tc = staffTotals(cur);
  const tp = staffTotals(prev);
  const has = prev.length > 0;
  const ph = { ...phrases(p), than: periodThan(t, p.period.kind, prevRange ?? p.prev) };
  const pp = t("delta.pp");
  const [table] = buildTables("staff", cur, { t, range: p.cur });
  const kpis: KpiProps[] = [
    { label: t("kpi.late"), value: String(tc.late), sub: t("kpi.daysSub", { count: tc.late }), change: has ? change(tc.late, tp.late, "relative") : null, unit: "%", testId: "kpi-late" },
    { label: t("kpi.missed"), value: String(tc.missed), sub: t("kpi.missedSub"), change: has ? change(tc.missed, tp.missed, "relative") : null, unit: "%", testId: "kpi-missed" },
    { label: t("kpi.hours"), value: pctText(tc.hoursRate), sub: `${Math.round(tc.worked / 60)} / ${Math.round(tc.planned / 60)}`, change: change(tc.hoursRate, tp.hoursRate, "points"), unit: pp, testId: "kpi-hours" },
    { label: t("kpi.autoClosed"), value: String(tc.autoClosed), sub: t("kpi.daysSub", { count: tc.autoClosed }), change: has ? change(tc.autoClosed, tp.autoClosed, "relative") : null, unit: "%", testId: "kpi-auto" },
    { label: t("kpi.edited"), value: String(tc.edited), sub: t("kpi.daysSub", { count: tc.edited }), change: has ? change(tc.edited, tp.edited, "relative") : null, unit: "%", testId: "kpi-edited" },
  ];
  const hoursRows = cur
    .filter((r) => r.planned_minutes || r.worked_minutes)
    .map((r) => ({ name: shortName(r.full_name), a: Math.round(r.planned_minutes / 60), b: Math.round(r.worked_minutes / 60) }));
  return (
    <div className="space-y-4" data-testid="section-staff">
      <KpiGrid t={t} items={kpis} />
      <ChartCard
        t={t}
        testId="chart-hours"
        title={t("charts.hours")}
        insight={renderInsight(t, hoursInsight(cur), ph)}
        note={prevRange ? `${t("notes.staff")} ${t("period.compare", { range: rangeLabel(prevRange) })}.` : t("notes.staff")}
      >
        {hoursRows.length ? (
          <HPairBars label={t("charts.hours")} rows={hoursRows} names={{ a: t("series.planned"), b: t("series.worked") }} />
        ) : (
          <ChartEmpty text={t("empty.chart")} />
        )}
      </ChartCard>
      <ChartCard t={t} testId="chart-discipline" title={t("charts.discipline")} insight={renderInsight(t, staffInsight(cur), ph)} table={table} exportUrl={exportHref("staff", "staff", p.period)} />
    </div>
  );
}

/** «Нурланова Асель Ериковна» → «Нурланова А.» for chart axes (the table keeps full names). */
function shortName(full: string) {
  const [last, first] = full.split(/\s+/);
  return first ? `${last} ${first[0]}.` : last;
}

// ───────────────────────────── 3. Finance ─────────────────────────────
async function FinanceSection(p: SectionProps) {
  const { t } = p;
  // while the period runs, the previous one is read «as of» the same day (payments accepted up to then, D-025 FIFO)
  const paidUntil = paidUntilPrev(p.period, p.prev, p.today);
  const [cur, prev] = await Promise.all([loadFinance(p.supabase, p.kgId, p.cur), loadFinance(p.supabase, p.kgId, p.prev, paidUntil)]);
  const tc = financeTotals(cur.months);
  const tp = financeTotals(prev.months);
  if (!tc.invoices && !cur.debtors.length) return <SectionEmpty title={t("empty.title")} hint={t("empty.finance")} />;
  const ph = phrases(p);
  const pp = t("delta.pp");
  const [months, debtors] = buildTables("finance", cur, { t, range: p.cur });
  const kpis: KpiProps[] = [
    { label: t("kpi.charged"), value: formatMoney(tc.charged), change: change(tc.charged, tp.charged, "relative"), unit: "%", testId: "kpi-charged" },
    { label: t("kpi.paid"), value: formatMoney(tc.paid), change: change(tc.paid, tp.paid, "relative"), unit: "%", testId: "kpi-paid" },
    { label: t("kpi.debt"), value: formatMoney(tc.debt), change: change(tc.debt, tp.debt, "relative"), unit: "%", danger: tc.debt > 0, testId: "kpi-debt" },
    { label: t("kpi.collection"), value: pctText(tc.collection), change: change(tc.collection, tp.collection, "points"), unit: pp, testId: "kpi-collection" },
    {
      label: t("kpi.payDays"),
      value: tc.avgDays == null ? "—" : String(Math.round(tc.avgDays)),
      sub: t("kpi.payDaysSub"),
      change: change(tc.avgDays, tp.avgDays, "points"),
      unit: t("delta.days"),
      testId: "kpi-paydays",
    },
  ];
  const years = new Set(cur.months.map((m) => m.period.slice(0, 4)));
  const bars = cur.months.map((m) => ({
    name: `${t(`monthsShort.${Number(m.period.slice(5, 7))}`)}${years.size > 1 ? ` ${m.period.slice(2, 4)}` : ""}`,
    paid: m.paid,
    debt: m.debt,
  }));
  return (
    <div className="space-y-4" data-testid="section-finance">
      <KpiGrid t={t} items={kpis} />
      <ChartCard
        t={t}
        testId="chart-finance"
        title={t("charts.finance")}
        insight={renderInsight(t, rateInsight("collection", tc.collection, tp.collection), ph)}
        note={paidUntil ? `${t("notes.finance")} ${t("notes.financeAsOf", { date: formatDate(paidUntil) })}` : t("notes.finance")}
      >
        {tc.charged ? <MoneyStack label={t("charts.finance")} rows={bars} names={{ paid: t("series.paid"), debt: t("series.debt") }} /> : <ChartEmpty text={t("empty.chart")} />}
      </ChartCard>
      <ChartCard t={t} testId="table-months-card" title={months.title} insight={renderInsight(t, payDaysInsight(tc.avgDays, tp.avgDays), ph)} table={months} exportUrl={exportHref("finance", "months", p.period)} />
      <ChartCard t={t} testId="chart-debtors" title={t("charts.debtors")} insight={renderInsight(t, debtorsInsight(cur.debtors, cur.today), ph)} table={debtors.rows.length ? debtors : undefined} exportUrl={exportHref("finance", "debtors", p.period)} />
    </div>
  );
}

// ───────────────────────────── 4. Funnel and churn ─────────────────────────────
async function FunnelSection(p: SectionProps) {
  const { t } = p;
  const [cur, prev] = await Promise.all([loadFunnel(p.supabase, p.kgId, p.cur), loadFunnel(p.supabase, p.kgId, p.prev)]);
  const tc = funnelTotals(cur);
  const tp = funnelTotals(prev);
  if (!cur.applications && !cur.joined && !cur.left && !cur.active.some((a) => a.n > 0)) return <SectionEmpty title={t("empty.title")} hint={t("empty.funnel")} />;
  const ph = phrases(p);
  const [funnel, churn, active] = buildTables("funnel", cur, { t, range: p.cur });
  const kpis: KpiProps[] = [
    { label: t("kpi.applications"), value: String(cur.applications), change: change(cur.applications, prev.applications, "relative"), unit: "%", testId: "kpi-applications" },
    { label: t("kpi.conversion"), value: pctText(tc.conversion), change: change(tc.conversion, tp.conversion, "points"), unit: t("delta.pp"), testId: "kpi-conversion" },
    { label: t("kpi.joined"), value: String(cur.joined), change: change(cur.joined, prev.joined, "relative"), unit: "%", testId: "kpi-joined" },
    { label: t("kpi.left"), value: String(cur.left), change: change(cur.left, prev.left, "relative"), unit: "%", testId: "kpi-left" },
    { label: t("kpi.active"), value: tc.activeEnd == null ? "—" : String(tc.activeEnd), change: change(tc.activeEnd, tp.activeEnd, "relative"), unit: "%", testId: "kpi-active" },
  ];
  const stages = funnel.rows.map((r) => ({ name: String(r.stage), value: Number(r.applications) }));
  const reasons = Object.entries(cur.left_reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ name: t(`leaveReasons.${k}`), value: n }));
  const series = activeSeries(cur, p.cur);
  return (
    <div className="space-y-4" data-testid="section-funnel">
      <KpiGrid t={t} items={kpis} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard t={t} testId="chart-funnel" title={t("charts.funnel")} insight={renderInsight(t, funnelInsight(cur), ph)} table={funnel} tableOpen={false} exportUrl={exportHref("funnel", "funnel", p.period)}>
          {cur.applications ? <HBars label={t("charts.funnel")} seriesName={t("series.count")} rows={stages} /> : <ChartEmpty text={t("empty.chart")} />}
        </ChartCard>
        <ChartCard t={t} testId="chart-churn" title={t("charts.churn")} insight={renderInsight(t, churnInsight(cur), ph)} table={churn} tableOpen={!reasons.length} exportUrl={exportHref("funnel", "churn", p.period)}>
          {reasons.length ? <HBars label={t("charts.churn")} seriesName={t("series.count")} rows={reasons} /> : null}
        </ChartCard>
      </div>
      <ChartCard t={t} testId="chart-active" title={t("charts.active")} insight={renderInsight(t, activeInsight(cur), ph)} table={active} tableOpen={false} exportUrl={exportHref("funnel", "active", p.period)}>
        <TrendLine
          label={t("charts.active")}
          seriesName={t("series.active")}
          points={series.points.map((x) => ({ label: series.g === "month" ? t(`monthsShort.${Number(x.d.slice(5, 7))}`) : shortDate(x.d), value: x.n }))}
        />
      </ChartCard>
    </div>
  );
}

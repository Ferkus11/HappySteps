/**
 * Analytics presentation shared by the page and the .xlsx export: period names, insight sentences and the
 * tables of each section (one definition → the table on screen and the exported sheet are the same).
 */
import {
  attendanceTotals,
  bucketize,
  daysIn,
  granularity,
  overdueDays,
  pct,
  periodFacts,
  staffTotals,
  financeTotals,
  type Granularity,
  type Insight,
  type Period,
  type PeriodKind,
  type Range,
  type Section,
} from "@/lib/analytics";
import type { AttendanceData, FinanceData, SectionData } from "@/lib/analytics-data";
import { formatDate, formatMoney } from "@/lib/format";

export type T = (key: string, values?: Record<string, string | number>) => string;

// ───────────────────────────── Period names ─────────────────────────────
const short = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function rangeLabel(r: Range): string {
  return r.from.slice(0, 4) === r.to.slice(0, 4) ? `${short(r.from)} – ${formatDate(r.to)}` : `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

export function periodLabel(t: T, p: Period): string {
  const f = periodFacts(p);
  switch (p.kind) {
    case "month":
      return t("label.month", { month: t(`months.${f.month}`), year: f.year });
    case "quarter":
      return t("label.quarter", { q: f.quarter, year: f.year });
    case "year":
      return t("label.year", { year: f.year });
    default:
      return rangeLabel(p);
  }
}

/** «в октябре» / «қазанда» — the current period inside a sentence. */
export function periodWhen(t: T, kind: PeriodKind, r: Range): string {
  const f = periodFacts({ ...r, kind });
  if (kind === "month") return t(`monthIn.${f.month}`);
  return t(`when.${kind}`, { q: f.quarter, year: f.year });
}

/** «сентября» / «қыркүйектен» — the previous period as the object of a comparison. */
export function periodThan(t: T, kind: PeriodKind, prev: Range): string {
  const f = periodFacts({ ...prev, kind });
  if (kind === "month") return t(`monthThan.${f.month}`);
  return t(`than.${kind}`, { q: f.quarter, year: f.year });
}

export function renderInsight(t: T, i: Insight | null, phrases: { when: string; than: string }): string | null {
  if (!i) return null;
  const v: Record<string, string | number> = { ...i.values, when: phrases.when, than: phrases.than };
  if (typeof v.sum === "number") v.sum = formatMoney(v.sum);
  if (i.key === "churnReason") v.reason = t(`leaveReasons.${String(v.reason)}`);
  return t(`insights.${i.key}`, v);
}

// ───────────────────────────── Tables ─────────────────────────────
export type ColKind = "text" | "int" | "pct" | "money" | "date" | "hours";
export interface Column {
  key: string;
  label: string;
  kind: ColKind;
  /** debt columns: red when > 0 (SPEC §8 — red only for errors and debts) */
  danger?: boolean;
}
export type Cell = string | number | null;
export interface DataTable {
  id: string;
  title: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  total?: Record<string, Cell>;
}

export const TABLE_IDS: Record<Section, string[]> = {
  attendance: ["days", "groups", "reasons"],
  staff: ["staff"],
  finance: ["months", "debtors"],
  funnel: ["funnel", "churn", "active"],
};

const hours = (min: number) => Math.round((min / 60) * 10) / 10;

export function bucketLabel(t: T, d: string, g: Granularity): string {
  if (g === "month") return t("label.month", { month: t(`months.${Number(d.slice(5, 7))}`), year: d.slice(0, 4) });
  return formatDate(d);
}

export function monthName(t: T, period: string): string {
  return t("label.month", { month: t(`months.${Number(period.slice(5, 7))}`), year: period.slice(0, 4) });
}

export function attendanceSeries(data: AttendanceData, r: Range) {
  const g = granularity(daysIn(r.from, r.to));
  return { g, points: bucketize(data.days, g).map((x) => ({ ...x, rate: pct(x.present, x.present + x.absent) })) };
}

export function groupsByAbsences(data: AttendanceData) {
  return [...data.groups].sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name));
}

export function activeSeries(f: SectionData["funnel"], r: Range) {
  const g = granularity(daysIn(r.from, r.to));
  return { g, points: bucketize(f.active, g, "last") };
}

export function debtorRows(f: FinanceData) {
  return f.debtors.map((d) => ({ ...d, overdue: overdueDays(d.since, f.today) }));
}

export interface TableCtx {
  t: T;
  range: Range;
}

export function buildTables<S extends Section>(section: S, data: SectionData[S], ctx: TableCtx): DataTable[] {
  const { t } = ctx;
  const col = (key: string, kind: ColKind, label = t(`cols.${key}`), danger = false): Column => ({ key, label, kind, danger });
  const name = (id: string) => t(`tableNames.${id}`);

  if (section === "attendance") {
    const d = data as AttendanceData;
    const { g, points } = attendanceSeries(d, ctx.range);
    const tot = attendanceTotals(d.days, d.groups);
    const reasonTotal = Object.values(d.reasons).reduce((s, n) => s + Number(n), 0);
    return [
      {
        id: "days",
        title: name("days"),
        columns: [col("label", "text", t(`cols.${g === "day" ? "date" : g === "week" ? "week" : "month"}`)), col("present", "int"), col("absent", "int"), col("sick", "int"), col("unmarked", "int"), col("rate", "pct")],
        rows: points.map((p) => ({ label: bucketLabel(t, p.d, g), present: p.present, absent: p.absent, sick: p.sick, unmarked: p.unmarked, rate: p.rate })),
        total: { label: t("total"), present: tot.present, absent: tot.absent, sick: tot.sick, unmarked: tot.unmarked, rate: tot.rate },
      },
      {
        id: "groups",
        title: name("groups"),
        columns: [col("group", "text"), col("absent", "int"), col("sick", "int"), col("present", "int"), col("rate", "pct"), col("sickShare", "pct"), col("children", "int"), col("capacity", "int"), col("fill", "pct")],
        rows: groupsByAbsences(d).map((x) => ({
          group: x.name,
          absent: x.absent,
          sick: x.sick,
          present: x.present,
          rate: pct(x.present, x.present + x.absent),
          sickShare: pct(x.sick, x.absent),
          children: x.children,
          capacity: x.capacity,
          fill: pct(x.children, x.capacity),
        })),
        total: { group: t("total"), absent: tot.absent, sick: tot.sick, present: tot.present, rate: tot.rate, sickShare: tot.sickShare, children: tot.children, capacity: tot.capacity, fill: tot.fill },
      },
      {
        id: "reasons",
        title: name("reasons"),
        columns: [col("reason", "text"), col("count", "int"), col("share", "pct")],
        rows: (["sick", "vacation", "family", "other", "none"] as const)
          .map((k) => ({ reason: t(`absenceReasons.${k}`), count: Number(d.reasons[k] ?? 0), share: pct(Number(d.reasons[k] ?? 0), reasonTotal) }))
          .filter((x) => x.count > 0)
          .sort((a, b) => b.count - a.count),
        total: { reason: t("total"), count: reasonTotal, share: reasonTotal ? 100 : null },
      },
    ];
  }

  if (section === "staff") {
    const rows = data as SectionData["staff"];
    const tot = staffTotals(rows);
    const sorted = [...rows].sort((a, b) => b.late_days - a.late_days || b.absent_days + b.unmarked_days - (a.absent_days + a.unmarked_days) || a.full_name.localeCompare(b.full_name));
    return [
      {
        id: "staff",
        title: name("staff"),
        columns: [
          col("employee", "text"),
          col("late", "int"),
          col("lateMinutes", "int"),
          col("absentDays", "int"),
          col("unmarkedDays", "int"),
          col("worked", "hours"),
          col("planned", "hours"),
          col("hoursRate", "pct"),
          col("scheduled", "int"),
          col("outside", "int"),
          col("autoClosed", "int"),
          col("edited", "int"),
        ],
        rows: sorted.map((r) => ({
          employee: r.archived ? `${r.full_name} (${t("archived")})` : r.full_name,
          late: r.late_days,
          lateMinutes: r.late_minutes,
          absentDays: r.absent_days,
          unmarkedDays: r.unmarked_days,
          worked: hours(r.worked_minutes),
          planned: hours(r.planned_minutes),
          hoursRate: pct(r.worked_minutes, r.planned_minutes),
          scheduled: r.scheduled_days,
          outside: r.outside_days,
          autoClosed: r.auto_closed_days,
          edited: r.edited_days,
        })),
        total: {
          employee: t("total"),
          late: tot.late,
          lateMinutes: rows.reduce((s, r) => s + r.late_minutes, 0),
          absentDays: tot.absent,
          unmarkedDays: tot.unmarked,
          worked: hours(tot.worked),
          planned: hours(tot.planned),
          hoursRate: tot.hoursRate,
          scheduled: rows.reduce((s, r) => s + r.scheduled_days, 0),
          outside: rows.reduce((s, r) => s + r.outside_days, 0),
          autoClosed: tot.autoClosed,
          edited: tot.edited,
        },
      },
    ];
  }

  if (section === "finance") {
    const f = data as FinanceData;
    const tot = financeTotals(f.months);
    const debtors = debtorRows(f);
    return [
      {
        id: "months",
        title: name("months"),
        columns: [col("month", "text"), col("charged", "money"), col("paid", "money"), col("debt", "money", undefined, true), col("overdue", "money", undefined, true), col("collection", "pct"), col("avgDays", "int"), col("invoices", "int")],
        rows: f.months.map((m) => ({
          month: monthName(t, m.period),
          charged: m.charged,
          paid: m.paid,
          debt: m.debt,
          overdue: m.overdue,
          collection: pct(m.paid, m.charged),
          avgDays: m.avg_days,
          invoices: m.invoices,
        })),
        total: { month: t("total"), charged: tot.charged, paid: tot.paid, debt: tot.debt, overdue: tot.overdue, collection: tot.collection, avgDays: tot.avgDays, invoices: tot.invoices },
      },
      {
        id: "debtors",
        title: name("debtors"),
        columns: [col("child", "text"), col("group", "text"), col("debt", "money", undefined, true), col("since", "date"), col("overdueDays", "int"), col("months", "int")],
        rows: debtors.map((d) => ({
          child: d.status === "archived" ? `${d.full_name} (${t("archived")})` : d.full_name,
          group: d.group_name ?? "",
          debt: d.debt,
          since: d.since,
          overdueDays: d.overdue,
          months: d.months,
        })),
        total: { child: t("total"), group: "", debt: debtors.reduce((s, d) => s + d.debt, 0), since: null, overdueDays: null, months: debtors.reduce((s, d) => s + d.months, 0) },
      },
    ];
  }

  const f = data as SectionData["funnel"];
  const { g, points } = activeSeries(f, ctx.range);
  return [
    {
      id: "funnel",
      title: name("funnel"),
      columns: [col("stage", "text"), col("applications", "int"), col("fromAll", "pct")],
      rows: (["applications", "contacted", "accepted", "declined"] as const).map((k) => ({ stage: t(`stages.${k}`), applications: f[k], fromAll: pct(f[k], f.applications) })),
    },
    {
      id: "churn",
      title: name("churn"),
      columns: [col("reason", "text"), col("kids", "int")],
      rows: [
        { reason: t("churnRows.joined"), kids: f.joined },
        { reason: t("churnRows.left"), kids: f.left },
        ...Object.entries(f.left_reasons)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => ({ reason: `— ${t(`leaveReasons.${k}`)}`, kids: n })),
      ],
    },
    {
      id: "active",
      title: name("active"),
      columns: [col("label", "text", t(`cols.${g === "day" ? "date" : g === "week" ? "week" : "month"}`)), col("active", "int")],
      rows: points.map((p) => ({ label: bucketLabel(t, p.d, g), active: p.n })),
    },
  ];
}

/** Text of a cell on screen (the .xlsx keeps raw numbers with number formats). */
export function formatCell(v: Cell, kind: ColKind): string {
  if (v == null || v === "") return "—";
  switch (kind) {
    case "money":
      return formatMoney(v);
    case "pct":
      return `${Math.round(Number(v))}%`;
    case "date":
      return formatDate(String(v));
    case "hours":
      return String(Math.round(Number(v)));
    case "int":
      return String(Math.round(Number(v) * 10) / 10).replace(".", ",");
    default:
      return String(v);
  }
}

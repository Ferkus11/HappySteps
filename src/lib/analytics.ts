/**
 * Analytics (SPEC §7) — pure logic: periods, comparison with the previous period, bucketing of series and the
 * one-line insights above each chart. No I/O here (unit-tested in tests/unit/analytics.test.ts).
 * All dates are YYYY-MM-DD local dates of the kindergarten.
 */
import type { Role } from "@/lib/auth/roles";

// ───────────────────────────── Access (SPEC §3.4 «Аналитика») ─────────────────────────────
export const SECTIONS = ["attendance", "staff", "finance", "funnel"] as const;
export type Section = (typeof SECTIONS)[number];

/** owner — everything; head — everything except finances; accountant — finances only; others — nothing. */
export function sectionsFor(role: Role): Section[] {
  if (role === "owner") return [...SECTIONS];
  if (role === "head") return ["attendance", "staff", "funnel"];
  if (role === "accountant") return ["finance"];
  return [];
}

export function isSection(v: unknown): v is Section {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
}

// ───────────────────────────── Dates ─────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = toUtc(v);
  return !Number.isNaN(d.getTime()) && fromUtc(d) === v;
}

export function addDays(d: string, n: number): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

/** Inclusive number of days between two dates (from ≤ to → ≥ 1). */
export function daysIn(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;
}

function weekday(d: string): number {
  const w = toUtc(d).getUTCDay();
  return w === 0 ? 7 : w;
}

const ymd = (y: number, m: number, day: number) => fromUtc(new Date(Date.UTC(y, m - 1, day)));
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];

// ───────────────────────────── Periods ─────────────────────────────
export const PERIOD_KINDS = ["week", "month", "quarter", "year", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const MAX_CUSTOM_DAYS = 366;

export interface Range {
  from: string;
  to: string;
}
export interface Period extends Range {
  kind: PeriodKind;
}

/** The calendar unit (Mon–Sun week, month, quarter, year) that contains `anchor`. */
export function calendarPeriod(kind: Exclude<PeriodKind, "custom">, anchor: string): Period {
  const [y, m] = parts(anchor);
  switch (kind) {
    case "week": {
      const from = addDays(anchor, 1 - weekday(anchor));
      return { kind, from, to: addDays(from, 6) };
    }
    case "month":
      return { kind, from: ymd(y, m, 1), to: ymd(y, m + 1, 0) };
    case "quarter": {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { kind, from: ymd(y, q0, 1), to: ymd(y, q0 + 3, 0) };
    }
    case "year":
      return { kind, from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
  }
}

export interface PeriodParams {
  p?: string;
  d?: string;
  from?: string;
  to?: string;
}

/** Why a custom range from the URL was not used: a date is missing/invalid, or the range is longer than allowed. */
export type PeriodProblem = "invalidRange" | "tooLong";

/**
 * Period from the URL: `p` = kind (default month), `d` = any date inside the calendar unit (default today),
 * custom: `from`/`to` (≤ 366 days, from ≤ to; swapped if reversed). Anything invalid falls back to the current month.
 */
export function parsePeriod(sp: PeriodParams, today: string): Period {
  return parsePeriodChecked(sp, today).period;
}

/** parsePeriod + the reason a custom range fell back to the current month (the picker shows it as a hint). */
export function parsePeriodChecked(sp: PeriodParams, today: string): { period: Period; problem: PeriodProblem | null } {
  const kind: PeriodKind = (PERIOD_KINDS as readonly string[]).includes(sp.p ?? "") ? (sp.p as PeriodKind) : "month";
  if (kind === "custom") {
    if (isIsoDate(sp.from) && isIsoDate(sp.to)) {
      const [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
      if (daysIn(from, to) <= MAX_CUSTOM_DAYS) return { period: { kind, from, to }, problem: null };
      return { period: calendarPeriod("month", today), problem: "tooLong" };
    }
    return { period: calendarPeriod("month", today), problem: "invalidRange" };
  }
  return { period: calendarPeriod(kind, isIsoDate(sp.d) ? sp.d : today), problem: null };
}

/** Previous/next period: the neighbouring calendar unit, or a custom range of the same length right before/after. */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  if (p.kind === "custom") {
    const len = daysIn(p.from, p.to);
    return dir < 0 ? { kind: p.kind, from: addDays(p.from, -len), to: addDays(p.from, -1) } : { kind: p.kind, from: addDays(p.to, 1), to: addDays(p.to, len) };
  }
  return calendarPeriod(p.kind, dir < 0 ? addDays(p.from, -1) : addDays(p.to, 1));
}

/**
 * Ranges to compare. Previous = the previous calendar unit (or equal-length custom range). While the period is
 * still running (today inside it) the previous one is cut to the same number of elapsed days, so counts compare
 * like for like («1–13 октября» vs «1–13 сентября»). `cur.to` is capped at today.
 */
export function comparison(p: Period, today: string): { cur: Range; prev: Range; running: boolean } {
  const prevFull = shiftPeriod(p, -1);
  if (today >= p.from && today < p.to) {
    const elapsed = daysIn(p.from, today);
    return { cur: { from: p.from, to: today }, prev: { from: prevFull.from, to: minDate(prevFull.to, addDays(prevFull.from, elapsed - 1)) }, running: true };
  }
  return { cur: { from: p.from, to: p.to }, prev: { from: prevFull.from, to: prevFull.to }, running: false };
}

const minDate = (a: string, b: string) => (a < b ? a : b);

/**
 * Staff numbers count closed days only (up to yesterday, see analytics_staff). The previous range is cut to the same
 * number of closed days while the period is not over yet (1–12 October ↔ 1–12 September on the 13th), and is null
 * when the current period has no closed day yet (nothing to compare).
 */
export function closedDaysPrev(period: Range, prev: Range, today: string): Range | null {
  const yesterday = addDays(today, -1);
  if (period.to <= yesterday) return prev;
  if (yesterday < period.from) return null;
  const closed = daysIn(period.from, yesterday);
  return { from: prev.from, to: minDate(prev.to, addDays(prev.from, closed - 1)) };
}

/**
 * Finance: invoices are per month and money keeps arriving, so while the period is not over (today inside it, the
 * last day included) the previous one is read «as of» the same day — payments accepted up to prev.from + elapsed
 * days, i.e. the end of the (already cut) previous range (analytics_finance p_paid_until). Null once the period is
 * over: both are compared as they stand today.
 */
export function paidUntilPrev(period: Range, prev: Range, today: string): string | null {
  return today >= period.from && today <= period.to ? prev.to : null;
}

export function isFuture(p: Range, today: string): boolean {
  return p.from > today;
}

/** URL query of a period (kind + anchor or custom range). */
export function periodQuery(p: Period): Record<string, string> {
  return p.kind === "custom" ? { p: "custom", from: p.from, to: p.to } : { p: p.kind, d: p.from };
}

/** Facts the UI needs to name a period in sentences and labels (the words themselves live in messages). */
export function periodFacts(p: Range & { kind: PeriodKind }) {
  const [y, m] = parts(p.from);
  return { kind: p.kind, year: y, month: m, quarter: Math.floor((m - 1) / 3) + 1 };
}

// ───────────────────────────── Numbers ─────────────────────────────
/** part / whole in percent (one decimal kept for comparisons), null when there is nothing to divide. */
export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type Dir = "up" | "down" | "same";
export interface Change {
  dir: Dir;
  /** absolute difference: percentage points for rates, % of the previous value for amounts */
  value: number;
}

/**
 * Change against the previous period. `points` — for rates (87% vs 83% → ▲ 4); `relative` — for amounts and counts
 * (12 vs 10 → ▲ 20 %). Null when the previous value is missing (or 0 for relative changes).
 */
export function change(cur: number | null | undefined, prev: number | null | undefined, mode: "points" | "relative"): Change | null {
  if (cur == null || prev == null) return null;
  let diff: number;
  if (mode === "points") diff = cur - prev;
  else {
    if (prev === 0) return null;
    diff = ((cur - prev) / Math.abs(prev)) * 100;
  }
  const value = Math.round(Math.abs(diff));
  return { dir: value === 0 ? "same" : diff > 0 ? "up" : "down", value };
}

// ───────────────────────────── Series ─────────────────────────────
export type Granularity = "day" | "week" | "month";

/** Days for up to ~2 months, weeks up to ~7 months, months beyond — a line stays readable on a phone. */
export function granularity(days: number): Granularity {
  if (days <= 62) return "day";
  if (days <= 215) return "week";
  return "month";
}

/** First date of the bucket `d` belongs to, never before `from` (a period starting on a Wednesday labels its first week with that Wednesday). */
export function bucketKey(d: string, g: Granularity, from?: string): string {
  const k = g === "day" ? d : g === "week" ? addDays(d, 1 - weekday(d)) : `${d.slice(0, 7)}-01`;
  return from && k < from ? from : k;
}

/**
 * Groups daily points into buckets (first date of the bucket as `d`, clamped to `from`). Numeric fields are summed
 * (`sum`) or the bucket's last value is kept (`last`, e.g. the number of active children).
 */
export function bucketize<T extends { d: string }>(points: T[], g: Granularity, mode: "sum" | "last" = "sum", from?: string): (T & { days: number })[] {
  const out = new Map<string, T & { days: number }>();
  for (const p of points) {
    const k = bucketKey(p.d, g, from);
    const cur = out.get(k);
    if (!cur) {
      out.set(k, { ...p, d: k, days: 1 });
      continue;
    }
    cur.days += 1;
    for (const [key, v] of Object.entries(p)) {
      if (key === "d" || typeof v !== "number") continue;
      const rec = cur as unknown as Record<string, number>;
      rec[key] = mode === "sum" ? (rec[key] ?? 0) + v : v;
    }
  }
  return [...out.values()];
}

// ───────────────────────────── Section math ─────────────────────────────
export interface AttendanceDay {
  d: string;
  enrolled: number;
  present: number;
  absent: number;
  sick: number;
  unmarked: number;
}
export interface AttendanceGroup {
  id: string;
  name: string;
  color: string;
  capacity: number;
  children: number;
  present: number;
  absent: number;
  sick: number;
  unmarked: number;
}

export function attendanceTotals(days: AttendanceDay[], groups: AttendanceGroup[]) {
  const sum = (k: keyof Omit<AttendanceDay, "d">) => days.reduce((s, x) => s + x[k], 0);
  const present = sum("present");
  const absent = sum("absent");
  const sick = sum("sick");
  const children = groups.reduce((s, g) => s + g.children, 0);
  const capacity = groups.reduce((s, g) => s + g.capacity, 0);
  return {
    present,
    absent,
    sick,
    unmarked: sum("unmarked"),
    marked: present + absent,
    rate: pct(present, present + absent),
    sickShare: pct(sick, absent),
    children,
    capacity,
    fill: pct(children, capacity),
    free: Math.max(0, capacity - children),
  };
}

export interface StaffRow {
  user_id: string;
  full_name: string;
  archived: boolean;
  scheduled_days: number;
  worked_days: number;
  late_days: number;
  late_minutes: number;
  absent_days: number;
  sick_days: number;
  vacation_days: number;
  unmarked_days: number;
  outside_days: number;
  planned_minutes: number;
  worked_minutes: number;
  auto_closed_days: number;
  edited_days: number;
}

export function staffTotals(rows: StaffRow[]) {
  const sum = (k: keyof StaffRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const planned = sum("planned_minutes");
  const worked = sum("worked_minutes");
  const worst = [...rows].filter((r) => r.late_days > 0).sort((a, b) => b.late_days - a.late_days || b.late_minutes - a.late_minutes)[0];
  return {
    late: sum("late_days"),
    absent: sum("absent_days"),
    unmarked: sum("unmarked_days"),
    missed: sum("absent_days") + sum("unmarked_days"),
    planned,
    worked,
    hoursRate: pct(worked, planned),
    autoClosed: sum("auto_closed_days"),
    edited: sum("edited_days"),
    mostLate: worst ? { name: worst.full_name, days: worst.late_days } : null,
  };
}

export interface FinanceMonth {
  period: string;
  invoices: number;
  charged: number;
  paid: number;
  debt: number;
  overdue: number;
  paid_invoices: number;
  avg_days: number | null;
}
export interface Debtor {
  child_id: string;
  full_name: string;
  status: "active" | "archived";
  group_name: string | null;
  debt: number;
  since: string;
  months: number;
}

export function financeTotals(months: FinanceMonth[]) {
  const charged = months.reduce((s, m) => s + m.charged, 0);
  const paid = months.reduce((s, m) => s + m.paid, 0);
  const debt = months.reduce((s, m) => s + m.debt, 0);
  const paidInvoices = months.reduce((s, m) => s + m.paid_invoices, 0);
  // average over invoices (weighted by the number of fully paid invoices of each month)
  const weighted = months.reduce((s, m) => s + (m.avg_days ?? 0) * (m.avg_days == null ? 0 : m.paid_invoices), 0);
  return {
    charged,
    paid,
    debt,
    overdue: months.reduce((s, m) => s + m.overdue, 0),
    invoices: months.reduce((s, m) => s + m.invoices, 0),
    collection: pct(paid, charged),
    avgDays: paidInvoices ? Math.round((weighted / paidInvoices) * 10) / 10 : null,
  };
}

/** Days a debt is overdue (0 while within the due date). */
export function overdueDays(since: string, today: string): number {
  return Math.max(0, daysIn(since, today) - 1);
}

/** Whether a debt is past its due date (overdue from the day after `since`). */
export function isOverdue(since: string, today: string): boolean {
  return today > since;
}

export interface FunnelData {
  applications: number;
  contacted: number;
  accepted: number;
  declined: number;
  joined: number;
  left: number;
  left_reasons: Record<string, number>;
  active: { d: string; n: number }[];
}

export function funnelTotals(f: FunnelData) {
  const first = f.active[0]?.n ?? null;
  const last = f.active.length ? f.active[f.active.length - 1].n : null;
  const reasons = Object.entries(f.left_reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    conversion: pct(f.accepted, f.applications),
    contactRate: pct(f.contacted, f.applications),
    activeStart: first,
    activeEnd: last,
    topReason: reasons[0]?.[0] ?? null,
    reasons,
  };
}

// ───────────────────────────── Insights ─────────────────────────────
/** A message key (analytics.insights.*) with its ICU values; the page renders it in the reader's language. */
export interface Insight {
  key: string;
  values: Record<string, string | number>;
}

const r0 = (n: number) => Math.round(n);

/** «{metric} — 87%, на 4% выше {than}» (points) or without a comparison. Null when there is no data. */
export function rateInsight(key: string, cur: number | null, prev: number | null): Insight | null {
  if (cur == null) return null;
  const c = change(cur, prev, "points");
  return c ? { key, values: { rate: r0(cur), dir: c.dir, diff: c.value } } : { key, values: { rate: r0(cur), dir: "none", diff: 0 } };
}

export function groupsInsight(groups: AttendanceGroup[]): Insight | null {
  const rated = groups
    .map((g) => ({ name: g.name, rate: pct(g.present, g.present + g.absent) }))
    .filter((g): g is { name: string; rate: number } => g.rate != null)
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  if (!rated.length) return null;
  const best = rated[0];
  const worst = rated[rated.length - 1];
  if (rated.length === 1 || best.rate === worst.rate) return { key: "groupsEven", values: { rate: r0(best.rate) } };
  return { key: "groups", values: { best: best.name, bestRate: r0(best.rate), worst: worst.name, worstRate: r0(worst.rate) } };
}

export function fillInsight(groups: AttendanceGroup[]): Insight | null {
  const t = attendanceTotals([], groups);
  if (!groups.length || t.fill == null) return null;
  const over = groups.filter((g) => g.children > g.capacity).map((g) => g.name);
  if (over.length) return { key: "fillOver", values: { fill: r0(t.fill), group: over[0], count: over.length } };
  return { key: "fill", values: { fill: r0(t.fill), free: t.free } };
}

export function topAbsenceInsight(groups: AttendanceGroup[]): Insight | null {
  const top = [...groups].sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name))[0];
  if (!top || top.absent === 0) return null;
  return { key: "topAbsences", values: { group: top.name, count: top.absent } };
}

export function staffInsight(rows: StaffRow[]): Insight | null {
  if (!rows.length) return null;
  const t = staffTotals(rows);
  if (!t.late && !t.missed) return { key: "staffClean", values: {} };
  if (t.mostLate) return { key: "staffLate", values: { late: t.late, missed: t.missed, name: t.mostLate.name, days: t.mostLate.days } };
  return { key: "staffMissed", values: { missed: t.missed } };
}

export function hoursInsight(rows: StaffRow[]): Insight | null {
  const t = staffTotals(rows);
  if (!t.planned && !t.worked) return null;
  return {
    key: t.planned ? "hours" : "hoursNoPlan",
    values: { rate: r0(t.hoursRate ?? 0), worked: r0(t.worked / 60), planned: r0(t.planned / 60) },
  };
}

export function debtorsInsight(debtors: Debtor[], today: string): Insight | null {
  if (!debtors.length) return { key: "debtorsNone", values: {} };
  const oldest = debtors.reduce((a, b) => (b.since < a.since ? b : a));
  return {
    key: "debtors",
    values: { count: debtors.length, sum: debtors.reduce((s, d) => s + d.debt, 0), days: overdueDays(oldest.since, today), name: oldest.full_name },
  };
}

export function payDaysInsight(cur: number | null, prev: number | null): Insight | null {
  if (cur == null) return null;
  const c = change(cur, prev, "points");
  return { key: "payDays", values: { days: r0(cur), dir: c?.dir ?? "none", diff: c?.value ?? 0 } };
}

export function funnelInsight(f: FunnelData): Insight | null {
  if (!f.applications) return null;
  return { key: "funnel", values: { apps: f.applications, accepted: f.accepted, rate: r0(pct(f.accepted, f.applications) ?? 0) } };
}

export function churnInsight(f: FunnelData): Insight | null {
  if (!f.joined && !f.left) return null;
  const t = funnelTotals(f);
  return { key: t.topReason ? "churnReason" : "churn", values: { joined: f.joined, left: f.left, reason: t.topReason ?? "" } };
}

export function activeInsight(f: FunnelData): Insight | null {
  const t = funnelTotals(f);
  if (t.activeEnd == null || t.activeStart == null) return null;
  const diff = t.activeEnd - t.activeStart;
  return { key: "active", values: { count: t.activeEnd, dir: diff > 0 ? "up" : diff < 0 ? "down" : "same", diff: Math.abs(diff) } };
}

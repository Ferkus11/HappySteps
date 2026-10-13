"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Recharts wrappers for the analytics page (SPEC §7). One hue for a single series (sky-strong), a light step of
 * the same hue for the «plan» series, red only for debt (SPEC §8). Every chart has an accessible name and its
 * numbers are also in the table under it.
 */
export const CHART = {
  primary: "#1f6fae",
  light: "#a7d0ef",
  debt: "#c8321e",
  grid: "#e6e9ef",
  axis: "#5f6878",
} as const;

const axisTick = { fill: CHART.axis, fontSize: 12 };
/** Legend text in neutral ink — Recharts colours it like the series, and the light «plan» blue is unreadable on white. */
const legendText = (value: unknown) => <span style={{ color: "#1d2330" }}>{String(value)}</span>;
const tooltipStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e6e9ef",
  boxShadow: "0 4px 16px rgb(16 24 40 / 0.08)",
  fontSize: 13,
  padding: "8px 10px",
};

function Frame({ label, height, children, testId }: { label: string; height: number; children: React.ReactElement; testId?: string }) {
  return (
    // overflow-hidden: Recharts keeps its (hidden) tooltip at the last hover position; after a resize or a rotation
    // that position can lie outside the new, narrower chart and widen the whole page (tooltips stay inside the chart).
    <div role="img" aria-label={label} className="w-full min-w-0 overflow-hidden" style={{ height }} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A line over time: `points` = [{ label, value }]. `percent` fixes the axis at 0–100. */
export function TrendLine({
  label,
  points,
  seriesName,
  percent = false,
  testId,
}: {
  label: string;
  points: { label: string; value: number | null }[];
  seriesName: string;
  percent?: boolean;
  testId?: string;
}) {
  const fmt = (v: unknown) => (v == null ? "—" : percent ? `${Math.round(Number(v))}%` : String(v));
  return (
    <Frame label={label} height={220} testId={testId}>
      <LineChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: -4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={24} interval="preserveStartEnd" />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={48}
          domain={percent ? [0, 100] : ["auto", "auto"]}
          allowDecimals={false}
          tickFormatter={(v) => (percent ? `${v}%` : String(v))}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(v), seriesName]} />
        <Line
          type="linear"
          dataKey="value"
          name={seriesName}
          stroke={CHART.primary}
          strokeWidth={2}
          dot={points.length <= 31 ? { r: 3, fill: CHART.primary, strokeWidth: 0 } : false}
          activeDot={{ r: 5 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </Frame>
  );
}

/** Horizontal bars, one per category (groups, stages, reasons). Names on the left, values at the bar ends. */
export function HBars({
  label,
  rows,
  seriesName,
  percent = false,
  max,
  testId,
}: {
  label: string;
  rows: { name: string; value: number | null }[];
  seriesName: string;
  percent?: boolean;
  max?: number;
  testId?: string;
}) {
  const fmt = (v: unknown) => (v == null ? "—" : percent ? `${Math.round(Number(v))}%` : String(v));
  return (
    <Frame label={label} height={Math.max(96, rows.length * 40 + 16)} testId={testId}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 0 }} barCategoryGap={8} accessibilityLayer>
        <XAxis type="number" hide domain={[0, max ?? (percent ? 100 : "auto")]} />
        <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={104} tickFormatter={(v) => clip(String(v), 14)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f2f5f9" }} formatter={(v) => [fmt(v), seriesName]} />
        <Bar dataKey="value" name={seriesName} fill={CHART.primary} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" formatter={(v: unknown) => fmt(v)} style={{ fill: "#1d2330", fontSize: 12, fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </Frame>
  );
}

/** Two series per category side by side, horizontal (e.g. planned vs worked hours per employee). */
export function HPairBars({
  label,
  rows,
  names,
  testId,
}: {
  label: string;
  rows: { name: string; a: number; b: number }[];
  names: { a: string; b: string };
  testId?: string;
}) {
  return (
    <Frame label={label} height={Math.max(120, rows.length * 56 + 48)} testId={testId}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }} barCategoryGap={10} barGap={2} accessibilityLayer>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={104} tickFormatter={(v) => clip(String(v), 14)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f2f5f9" }} />
        <Legend itemSorter={null} iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        <Bar dataKey="a" name={names.a} fill={CHART.light} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
          <LabelList dataKey="a" position="right" style={{ fill: "#5f6878", fontSize: 11 }} />
        </Bar>
        <Bar dataKey="b" name={names.b} fill={CHART.primary} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
          <LabelList dataKey="b" position="right" style={{ fill: "#1d2330", fontSize: 11, fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </Frame>
  );
}

/** Vertical stacked bars per month: paid + debt = charged. Money is shortened on the axis («120k»). */
export function MoneyStack({
  label,
  rows,
  names,
  testId,
}: {
  label: string;
  rows: { name: string; paid: number; debt: number }[];
  names: { paid: string; debt: string };
  testId?: string;
}) {
  const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `${Math.round(v / 100_000) / 10}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  const money = (v: unknown) => `${Math.round(Number(v ?? 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;
  return (
    <Frame label={label} height={240} testId={testId}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap="28%" accessibilityLayer>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => short(Number(v))} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f2f5f9" }} formatter={(v, n) => [money(v), n]} />
        <Legend itemSorter={null} iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        <Bar dataKey="paid" name={names.paid} stackId="m" fill={CHART.primary} maxBarSize={48} isAnimationActive={false} />
        <Bar dataKey="debt" name={names.debt} stackId="m" fill={CHART.debt} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
      </BarChart>
    </Frame>
  );
}

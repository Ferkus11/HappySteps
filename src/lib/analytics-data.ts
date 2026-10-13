import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendanceDay, AttendanceGroup, Debtor, FinanceMonth, FunnelData, Range, Section, StaffRow } from "@/lib/analytics";

/**
 * Loaders of the analytics sections. Every number is aggregated in SQL (analytics_* functions,
 * migration 20261016100000_analytics.sql); the functions check the caller's role and garden themselves,
 * so a forbidden section fails here even if a page forgot its own check.
 */
export interface AttendanceData {
  on_date: string;
  days: AttendanceDay[];
  groups: AttendanceGroup[];
  reasons: Record<"sick" | "vacation" | "family" | "other" | "none", number>;
}
export interface FinanceData {
  today: string;
  /** the date the money is counted up to (today, or the cut-off of the previous period) */
  paid_until: string;
  months: FinanceMonth[];
  debtors: Debtor[];
}

export class AnalyticsForbidden extends Error {}

async function rpc<T>(supabase: SupabaseClient, fn: string, kg: string, r: Range, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { kg, p_from: r.from, p_to: r.to, ...extra });
  if (error) {
    if (error.code === "42501" || error.message.includes("hs:forbidden")) throw new AnalyticsForbidden(fn);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export async function loadAttendance(supabase: SupabaseClient, kg: string, r: Range): Promise<AttendanceData> {
  const d = await rpc<AttendanceData>(supabase, "analytics_attendance", kg, r);
  return { ...d, groups: d.groups.map((g) => ({ ...g, capacity: num(g.capacity) })) };
}

export async function loadStaff(supabase: SupabaseClient, kg: string, r: Range): Promise<StaffRow[]> {
  return (await rpc<StaffRow[] | null>(supabase, "analytics_staff", kg, r)) ?? [];
}

/** `paidUntil` — read the money «as of» that local date (the previous period while the current one runs). */
export async function loadFinance(supabase: SupabaseClient, kg: string, r: Range, paidUntil: string | null = null): Promise<FinanceData> {
  const d = await rpc<FinanceData>(supabase, "analytics_finance", kg, r, paidUntil ? { p_paid_until: paidUntil } : {});
  return {
    today: d.today,
    paid_until: d.paid_until,
    months: d.months.map((m) => ({
      ...m,
      charged: num(m.charged),
      paid: num(m.paid),
      debt: num(m.debt),
      overdue: num(m.overdue),
      avg_days: m.avg_days == null ? null : num(m.avg_days),
    })),
    debtors: d.debtors.map((x) => ({ ...x, debt: num(x.debt) })),
  };
}

export async function loadFunnel(supabase: SupabaseClient, kg: string, r: Range): Promise<FunnelData> {
  const d = await rpc<FunnelData>(supabase, "analytics_funnel", kg, r);
  return {
    ...d,
    applications: num(d.applications),
    contacted: num(d.contacted),
    accepted: num(d.accepted),
    declined: num(d.declined),
    joined: num(d.joined),
    left: num(d.left),
    left_reasons: Object.fromEntries(Object.entries(d.left_reasons ?? {}).map(([k, v]) => [k, num(v)])),
  };
}

export type SectionData = {
  attendance: AttendanceData;
  staff: StaffRow[];
  finance: FinanceData;
  funnel: FunnelData;
};

export function loadSection<S extends Section>(supabase: SupabaseClient, section: S, kg: string, r: Range): Promise<SectionData[S]> {
  const loaders = { attendance: loadAttendance, staff: loadStaff, finance: loadFinance, funnel: loadFunnel } as const;
  return (loaders[section] as (s: SupabaseClient, k: string, rr: Range) => Promise<SectionData[S]>)(supabase, kg, r);
}

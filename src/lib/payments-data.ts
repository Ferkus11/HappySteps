import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INVOICE_COLUMNS, toInvoice, type Invoice, type ReceiptStatus } from "@/lib/payments";

export interface ChildRef {
  id: string;
  full_name: string;
  status: "active" | "archived";
  group_id: string | null;
}

export interface InvoiceWithChild extends Invoice {
  child: ChildRef;
  isLatest: boolean;
}

export interface Receipt {
  id: string;
  invoice_id: string;
  child_id: string;
  uploaded_by: string | null;
  mime: string;
  status: ReceiptStatus;
  confirmed_amount: number | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export const RECEIPT_COLUMNS = "id, invoice_id, child_id, uploaded_by, mime, status, confirmed_amount, reject_reason, reviewed_at, created_at";

export function toReceipt(r: Record<string, unknown>): Receipt {
  return {
    id: String(r.id),
    invoice_id: String(r.invoice_id),
    child_id: String(r.child_id),
    uploaded_by: (r.uploaded_by as string | null) ?? null,
    mime: String(r.mime),
    status: r.status as ReceiptStatus,
    confirmed_amount: r.confirmed_amount == null ? null : Number(r.confirmed_amount),
    reject_reason: (r.reject_reason as string | null) ?? null,
    reviewed_at: (r.reviewed_at as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

/** All invoices of a month (RLS: staff with payments access see all, a parent only own children). */
export async function loadMonth(supabase: SupabaseClient, kgId: string, period: string): Promise<InvoiceWithChild[]> {
  const [{ data }, { data: later }] = await Promise.all([
    supabase
      .from("invoices")
      .select(`${INVOICE_COLUMNS}, children(id, full_name, status, group_id)`)
      .eq("kindergarten_id", kgId)
      .eq("period", period),
    supabase.from("invoices").select("child_id").eq("kindergarten_id", kgId).gt("period", period),
  ]);
  const hasLater = new Set((later ?? []).map((r) => r.child_id as string));
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ ...toInvoice(r), child: r.children as ChildRef, isLatest: !hasLater.has(String(r.child_id)) }))
    .sort((a, b) => a.child.full_name.localeCompare(b.child.full_name, "ru"));
}

export interface PendingReceipt extends Receipt {
  invoice: Invoice;
  child: ChildRef;
}

/** Receipts waiting for review, oldest first (the accountant's queue). */
export async function loadPending(supabase: SupabaseClient, kgId: string, limit = 200): Promise<PendingReceipt[]> {
  const { data } = await supabase
    .from("payment_receipts")
    .select(`${RECEIPT_COLUMNS}, invoices(${INVOICE_COLUMNS}), children(id, full_name, status, group_id)`)
    .eq("kindergarten_id", kgId)
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...toReceipt(r),
    invoice: toInvoice(r.invoices as Record<string, unknown>),
    child: r.children as ChildRef,
  }));
}

export async function countPending(supabase: SupabaseClient, kgId: string): Promise<number> {
  const { count } = await supabase
    .from("payment_receipts")
    .select("id", { count: "exact", head: true })
    .eq("kindergarten_id", kgId)
    .eq("status", "pending");
  return count ?? 0;
}

export interface Debtor {
  child_id: string;
  full_name: string;
  child_status: "active" | "archived";
  group_id: string | null;
  invoice_id: string;
  period: string;
  debt: number;
  since: string;
}

export async function loadDebtors(supabase: SupabaseClient, kgId: string): Promise<Debtor[]> {
  const { data } = await supabase.rpc("payment_debtors", { p_kg: kgId });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    child_id: String(r.child_id),
    full_name: String(r.full_name),
    child_status: r.child_status as Debtor["child_status"],
    group_id: (r.group_id as string | null) ?? null,
    invoice_id: String(r.invoice_id),
    period: String(r.period),
    debt: Number(r.debt),
    since: String(r.since),
  }));
}

/** Every invoice (newest first) and receipt of the given children. */
export async function loadChildrenHistory(supabase: SupabaseClient, childIds: string[]) {
  if (!childIds.length) return { invoices: [] as Invoice[], receipts: [] as Receipt[] };
  const [{ data: inv }, { data: rec }] = await Promise.all([
    supabase.from("invoices").select(INVOICE_COLUMNS).in("child_id", childIds).order("period", { ascending: false }),
    supabase.from("payment_receipts").select(RECEIPT_COLUMNS).in("child_id", childIds).order("created_at", { ascending: false }),
  ]);
  return {
    invoices: ((inv ?? []) as Record<string, unknown>[]).map(toInvoice),
    receipts: ((rec ?? []) as Record<string, unknown>[]).map(toReceipt),
  };
}

/** The latest invoice of a child (its balance is the child's current balance). */
export async function latestInvoice(supabase: SupabaseClient, childId: string): Promise<Invoice | null> {
  const { data } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("child_id", childId).order("period", { ascending: false }).limit(1).maybeSingle();
  return data ? toInvoice(data as Record<string, unknown>) : null;
}

/** Total current debt of the kindergarten (sum of positive balances of each child's latest invoice). */
export async function totalDebt(supabase: SupabaseClient, kgId: string): Promise<number> {
  return (await loadDebtors(supabase, kgId)).reduce((s, d) => s + d.debt, 0);
}

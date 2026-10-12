/**
 * Kindergarten fees (SPEC §5.9) — pure helpers shared by pages, widgets, exports and tests.
 * Balance model (see supabase/migrations/20261014120000_payments.sql): each invoice is a monthly statement
 * carried (debt > 0 / advance < 0 from earlier months) + amount − paid = balance, carried into the next month.
 */

export const INVOICE_STATUSES = ["unpaid", "review", "paid", "partial", "rejected"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** Stored status plus the computed "overdue". */
export type DisplayStatus = InvoiceStatus | "overdue";
export const DISPLAY_STATUSES: DisplayStatus[] = ["unpaid", "overdue", "review", "partial", "rejected", "paid"];

export type ReceiptStatus = "pending" | "accepted" | "rejected";

export interface Invoice {
  id: string;
  child_id: string;
  period: string; // YYYY-MM-01
  amount_original: number;
  amount: number;
  adjustment_comment: string | null;
  adjusted_at: string | null;
  due_date: string;
  carried: number;
  paid_amount: number;
  balance: number;
  status: InvoiceStatus;
  paid_at: string | null;
}

export const INVOICE_COLUMNS =
  "id, child_id, period, amount_original, amount, adjustment_comment, adjusted_at, due_date, carried, paid_amount, balance, status, paid_at";

/** PostgREST returns numeric as string — normalise a row. */
export function toInvoice(r: Record<string, unknown>): Invoice {
  return {
    id: String(r.id),
    child_id: String(r.child_id),
    period: String(r.period),
    amount_original: Number(r.amount_original),
    amount: Number(r.amount),
    adjustment_comment: (r.adjustment_comment as string | null) ?? null,
    adjusted_at: (r.adjusted_at as string | null) ?? null,
    due_date: String(r.due_date),
    carried: Number(r.carried),
    paid_amount: Number(r.paid_amount),
    balance: Number(r.balance),
    status: r.status as InvoiceStatus,
    paid_at: (r.paid_at as string | null) ?? null,
  };
}

/**
 * Overdue is computed, not stored: only the child's latest invoice (older balances are carried into it),
 * something is still owed, no receipt is waiting for review and the due date has passed.
 */
export function isOverdue(inv: Pick<Invoice, "balance" | "status" | "due_date">, today: string, isLatest: boolean): boolean {
  return isLatest && inv.balance > 0 && inv.status !== "review" && today > inv.due_date;
}

export function displayStatus(inv: Pick<Invoice, "balance" | "status" | "due_date">, today: string, isLatest: boolean): DisplayStatus {
  return isOverdue(inv, today, isLatest) ? "overdue" : inv.status;
}

/** What is still to pay on this invoice (never negative). */
export const toPay = (inv: Pick<Invoice, "balance">) => Math.max(0, inv.balance);
/** Advance left after this invoice (overpayment credited to the next month). */
export const advanceOf = (inv: Pick<Invoice, "balance">) => Math.max(0, -inv.balance);

export interface Totals {
  accrued: number;
  paid: number;
  debt: number;
  count: number;
}

export function totals(list: Pick<Invoice, "amount" | "paid_amount" | "balance">[]): Totals {
  return list.reduce<Totals>(
    (s, i) => ({ accrued: s.accrued + i.amount, paid: s.paid + i.paid_amount, debt: s.debt + Math.max(0, i.balance), count: s.count + 1 }),
    { accrued: 0, paid: 0, debt: 0, count: 0 },
  );
}

/** Paid share of the accrued amount, 0..100 (payments of carried debt can push it over — clamp). */
export function collectedPercent(t: Pick<Totals, "accrued" | "paid">): number {
  if (t.accrued <= 0) return t.paid > 0 ? 100 : 0;
  return Math.min(100, Math.round((t.paid / t.accrued) * 100));
}

/** `YYYY-MM` from a query string, falling back to the month of `today`. */
export function parseMonth(raw: string | null | undefined, today: string): string {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return today.slice(0, 7);
}

export const periodOf = (month: string) => `${month}-01`;

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Whole days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Month number 1..12 and year of a period. */
export function periodParts(period: string): { month: number; year: number } {
  return { month: Number(period.slice(5, 7)), year: Number(period.slice(0, 4)) };
}

/** Payment purpose shown to the parent: the kindergarten's text + child + month. */
export function paymentPurpose(base: string | undefined, childName: string, monthLabel: string): string {
  return [base?.trim(), childName, monthLabel].filter(Boolean).join(", ");
}

export const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

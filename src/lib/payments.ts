/**
 * Kindergarten fees (SPEC §5.9) — pure helpers shared by pages, widgets, exports and tests.
 * Balance model (see supabase/migrations/20261014120000_payments.sql): FIFO allocation. The child's confirmed
 * money settles invoices oldest month first; each invoice keeps its own balance = amount − paid (≥ 0), so a debt
 * appears exactly once. `carried` (open balance of older months) is informational: the statement of an invoice
 * is carried + balance; `advance` (overpayment) sits on the child's latest invoice until the next month takes it.
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
  /** The child's first day when they started after the 1st (full fee charged — check the amount). */
  starts_on: string | null;
  carried: number;
  paid_amount: number;
  balance: number;
  advance: number;
  /** Due date of the oldest open invoice up to this one (null when nothing is owed through this month). */
  debt_since: string | null;
  status: InvoiceStatus;
  paid_at: string | null;
}

export const INVOICE_COLUMNS =
  "id, child_id, period, amount_original, amount, adjustment_comment, adjusted_at, due_date, starts_on, carried, paid_amount, balance, advance, debt_since, status, paid_at";

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
    starts_on: (r.starts_on as string | null) ?? null,
    carried: Number(r.carried),
    paid_amount: Number(r.paid_amount),
    balance: Number(r.balance),
    advance: Number(r.advance ?? 0),
    debt_since: (r.debt_since as string | null) ?? null,
    status: r.status as InvoiceStatus,
    paid_at: (r.paid_at as string | null) ?? null,
  };
}

/**
 * Overdue is computed, not stored. One invoice (month lists, history, xlsx): its own balance is still open,
 * no receipt is waiting for review and its due date has passed.
 */
export function isOverdue(inv: Pick<Invoice, "balance" | "status" | "due_date">, today: string): boolean {
  return inv.balance > 0 && inv.status !== "review" && today > inv.due_date;
}

export function displayStatus(inv: Pick<Invoice, "balance" | "status" | "due_date">, today: string): DisplayStatus {
  return isOverdue(inv, today) ? "overdue" : inv.status;
}

type Statement = Pick<Invoice, "carried" | "balance" | "status" | "debt_since">;

/**
 * Status of a child's statement up to this invoice (the parent's current invoice, the child card, the invoice page):
 * overdue as soon as any open amount belongs to an invoice past its due date — also between the 1st and the due day
 * of the new month for a chronic debtor.
 */
export function statementStatus(inv: Statement, today: string): DisplayStatus {
  const owed = inv.carried + inv.balance;
  if (owed > 0 && inv.status !== "review" && inv.debt_since && today > inv.debt_since) return "overdue";
  if (owed > 0 && inv.status === "paid") return "unpaid"; // this month is covered, older months are not
  return inv.status;
}

/** What is still to pay up to and including this invoice (older open months + this month). */
export const toPay = (inv: Pick<Invoice, "carried" | "balance">) => Math.max(0, inv.carried + inv.balance);
/** Overpayment left after the child's latest invoice (taken by the next month's invoice). */
export const advanceOf = (inv: Pick<Invoice, "advance">) => Math.max(0, inv.advance);

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

/** Paid share of the accrued amount, 0..100 (allocated payments never exceed the charges; clamp anyway). */
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

/** Payment purpose shown to the parent: the kindergarten's text + child + "за октябрь 2026". */
export function paymentPurpose(base: string | undefined, childName: string, forMonth: string): string {
  return [base?.trim(), childName, forMonth].filter(Boolean).join(", ");
}

/** Months the owner/accountant may accrue by hand: the current one, and the previous one if the kindergarten
 * already billed it or earlier (mirrors SQL accrue_invoices). `firstPeriod` = earliest invoice period or null. */
export function canAccrueMonth(month: string, today: string, firstPeriod: string | null): boolean {
  const cur = today.slice(0, 7);
  if (month === cur) return true;
  return month === shiftMonth(cur, -1) && firstPeriod !== null && firstPeriod.slice(0, 7) <= month;
}

export const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

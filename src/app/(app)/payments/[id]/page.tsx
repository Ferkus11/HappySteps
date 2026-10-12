import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, Receipt as ReceiptIcon } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { RECEIPT_COLUMNS, toReceipt } from "@/lib/payments-data";
import { INVOICE_COLUMNS, advanceOf, displayStatus, toInvoice, toPay } from "@/lib/payments";
import { formatDate, formatDateTime, formatMoney, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InvoiceBreakdown } from "@/components/payments/breakdown";
import { InvoiceStatusBadge, ReceiptStatusBadge } from "@/components/payments/status-badge";
import { ReviewDialog } from "@/components/payments/review-dialog";
import { AdjustDialog } from "@/components/payments/adjust-dialog";
import { UploadReceiptButton } from "@/components/payments/upload-receipt";
import { monthLabel } from "@/components/payments/month";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("payments"))("title") };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg(["owner", "head", "accountant", "parent"]);
  const t = await getTranslations("payments");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("invoices")
    .select(`${INVOICE_COLUMNS}, children(id, full_name, status)`)
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  // RLS: a parent sees only invoices of own children; teachers, cooks and other gardens see nothing.
  if (!row) notFound();
  const inv = toInvoice(row as Record<string, unknown>);
  const child = (row as unknown as { children: { id: string; full_name: string; status: string } }).children;
  const [{ count: later }, { data: recs }] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("child_id", inv.child_id).gt("period", inv.period),
    supabase.from("payment_receipts").select(RECEIPT_COLUMNS).eq("invoice_id", id).order("created_at", { ascending: false }),
  ]);
  const receipts = ((recs ?? []) as Record<string, unknown>[]).map(toReceipt);
  const isLatest = !later;
  const today = todayIn(ctx.settings.timezone);
  const status = displayStatus(inv, today, isLatest);
  const month = monthLabel(t, inv.period);
  const canManage = ctx.role === "owner" || ctx.role === "accountant";
  const isParent = ctx.role === "parent";
  const tz = ctx.settings.timezone;
  const backHref = isParent ? "/payments" : "/payments?tab=month&month=" + inv.period.slice(0, 7);

  return (
    <>
      <div className="mb-2">
        <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> {t("allInvoices")}
        </Link>
      </div>
      <PageHeader
        title={<span data-testid="invoice-title">{t("invoiceTitle", { month })}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {isParent ? child.full_name : <Link href={`/children/${child.id}`} className="font-semibold text-text hover:text-brand">{child.full_name}</Link>}
            {child.status === "archived" ? <Badge>{t("archived")}</Badge> : null}
          </span>
        }
        actions={canManage ? <AdjustDialog invoiceId={inv.id} amount={inv.amount} description={`${child.full_name} · ${month}`} /> : null}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
        <Card data-testid="invoice-card" data-status={status}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-muted">{status === "paid" ? t("allPaid") : t("toPay")}</div>
              <div className={cn("mt-1 text-[34px] leading-none font-extrabold tracking-tight tabular-nums", status === "overdue" && "text-danger")} data-testid="invoice-to-pay">
                {formatMoney(toPay(inv))}
              </div>
            </div>
            <InvoiceStatusBadge status={status} className="shrink-0" />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-muted">
            <CalendarClock className="size-4 shrink-0" aria-hidden /> {t("dueDate")}: {formatDate(inv.due_date)}
          </div>
          {advanceOf(inv) > 0 ? (
            <p className="mt-2 text-sm font-semibold text-success" data-testid="invoice-advance">
              {t("advanceNext", { amount: formatMoney(advanceOf(inv)) })}
            </p>
          ) : null}
          <div className="mt-4 border-t border-border pt-4">
            <InvoiceBreakdown inv={inv} />
          </div>
          {isParent && isLatest && toPay(inv) > 0 ? (
            <div className="mt-5">
              <UploadReceiptButton invoiceId={inv.id} again={inv.status === "rejected"} className="w-full sm:w-auto sm:px-8" />
            </div>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("receipts")} />
          {receipts.length === 0 ? (
            <EmptyState icon={ReceiptIcon} title={t("noReceipts")} className="py-6" />
          ) : (
            <ul className="space-y-3" data-testid="invoice-receipts">
              {receipts.map((r) => (
                <li key={r.id} className="rounded-2xl bg-surface-muted p-3" data-testid="receipt-row" data-status={r.status}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{t("receiptFrom", { date: formatDateTime(r.created_at, tz) })}</span>
                    <ReceiptStatusBadge status={r.status} />
                  </div>
                  {r.status === "accepted" && r.confirmed_amount ? (
                    <p className="mt-1 text-sm text-muted">{t("confirmedAmount", { amount: formatMoney(r.confirmed_amount) })}</p>
                  ) : null}
                  {r.status === "rejected" && r.reject_reason ? <p className="mt-1 text-sm text-danger">{t("reason", { reason: r.reject_reason })}</p> : null}
                  <div className="mt-2">
                    <ReviewDialog
                      receipt={{
                        id: r.id,
                        childName: child.full_name,
                        subtitle: `${month} · ${t("uploadedAt", { date: formatDateTime(r.created_at, tz) })}`,
                        pending: r.status === "pending",
                        toPay: toPay(inv),
                      }}
                      canReview={canManage}
                      label={canManage && r.status === "pending" ? t("check") : t("view")}
                      variant={canManage && r.status === "pending" ? "primary" : "outline"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

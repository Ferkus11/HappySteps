import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, ChevronRight, Info, Receipt as ReceiptIcon, Wallet } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadChildrenHistory, type Receipt } from "@/lib/payments-data";
import { advanceOf, displayStatus, paymentPurpose, toPay, type Invoice } from "@/lib/payments";
import { formatDate, formatDateTime, formatMoney, todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { InvoiceBreakdown } from "./breakdown";
import { InvoiceStatusBadge, ReceiptStatusBadge } from "./status-badge";
import { Requisites, type RequisiteItem } from "./requisites";
import { UploadReceiptButton } from "./upload-receipt";
import { ReviewDialog } from "./review-dialog";
import { monthLabel } from "./month";

export interface ParentKid {
  id: string;
  full_name: string;
  status: "active" | "archived";
}

/** Children of the current parent (active ones, plus archived ones that still owe). */
export async function parentKids(ctx: KgContext): Promise<ParentKid[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("child_guardians")
    .select("children!inner(id, full_name, status)")
    .eq("user_id", ctx.userId)
    .eq("kindergarten_id", ctx.kg.id);
  return ((data ?? []) as unknown as { children: ParentKid }[])
    .map((r) => r.children)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
}

export async function loadParentPayments(ctx: KgContext) {
  const supabase = await createClient();
  const kids = await parentKids(ctx);
  const { invoices, receipts } = await loadChildrenHistory(
    supabase,
    kids.map((k) => k.id),
  );
  const items = kids
    .map((kid) => {
      const list = invoices.filter((i) => i.child_id === kid.id);
      return { kid, latest: list[0] ?? null, older: list.slice(1), receipts: receipts.filter((r) => r.child_id === kid.id) };
    })
    .filter((x) => x.kid.status === "active" || (x.latest && x.latest.balance > 0));
  return items;
}

function requisiteItems(ctx: KgContext, t: (k: string) => string, purpose: string): RequisiteItem[] {
  const r = ctx.settings.requisites ?? {};
  const items: RequisiteItem[] = [];
  for (const key of ["kaspi", "iban", "bank", "recipient"] as const) {
    const v = (r[key] ?? "").trim();
    if (v) items.push({ key, label: t(key), value: v });
  }
  if (items.length) items.push({ key: "purpose", label: t("purpose"), value: purpose });
  return items;
}

/** One child's current invoice: amount to pay, due date, status, «Загрузить чек». */
export async function CurrentInvoice({
  ctx,
  kid,
  inv,
  receipts,
  compact,
}: {
  ctx: KgContext;
  kid: ParentKid;
  inv: Invoice;
  receipts: Receipt[];
  compact?: boolean;
}) {
  const t = await getTranslations("payments");
  const today = todayIn(ctx.settings.timezone);
  const status = displayStatus(inv, today, true);
  const due = toPay(inv);
  const lastRejected = receipts.find((r) => r.invoice_id === inv.id && r.status !== "pending");
  const tone = status === "paid" ? "bg-success-soft" : status === "overdue" ? "bg-danger-soft" : "bg-surface-muted";
  return (
    <div data-testid="current-invoice" data-child={kid.full_name} data-invoice={inv.id}>
      <div className={cn("rounded-2xl p-4", tone)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-muted">{status === "paid" ? t("allPaid") : t("toPay")}</div>
            <div
              className={cn("mt-1 text-[32px] leading-none font-extrabold tracking-tight tabular-nums", status === "overdue" && "text-danger")}
              data-testid="parent-to-pay"
            >
              {formatMoney(due)}
            </div>
          </div>
          <InvoiceStatusBadge status={status} className="shrink-0" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-sm text-muted">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {t("payUntil", { date: formatDate(inv.due_date) })}
        </div>
        {advanceOf(inv) > 0 ? <p className="mt-2 text-sm font-semibold text-success">{t("advanceNext", { amount: formatMoney(advanceOf(inv)) })}</p> : null}
        {status === "review" ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-tile-unmarked-fg">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("inReviewHint")}
          </p>
        ) : lastRejected?.status === "rejected" && inv.status === "rejected" ? (
          <p className="mt-2 text-sm font-semibold text-danger" data-testid="rejected-reason">
            {t("rejectedHint", { reason: lastRejected.reject_reason ?? "" })}
          </p>
        ) : null}
      </div>
      {!compact ? (
        <div className="mt-3">
          <InvoiceBreakdown inv={inv} />
        </div>
      ) : null}
      {due > 0 ? (
        <div className="mt-4">
          <UploadReceiptButton invoiceId={inv.id} again={inv.status === "rejected"} className="w-full sm:w-auto sm:px-8" variant={inv.status === "review" ? "outline" : "primary"} />
          {!compact ? <p className="mt-1.5 text-xs text-faint">{t("uploadHint")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReceiptRows({ receipts, t, canView }: { receipts: Receipt[]; t: Awaited<ReturnType<typeof getTranslations>>; canView: { childName: string; subtitle: (r: Receipt) => string } }) {
  if (!receipts.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {receipts.map((r) => (
        <li key={r.id} className="flex min-h-11 items-center gap-2 text-sm" data-testid="receipt-row" data-status={r.status}>
          <ReceiptIcon className="size-4 shrink-0 text-faint" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted">{t("receiptFrom", { date: formatDate(r.created_at) })}</span>
              <ReceiptStatusBadge status={r.status} />
            </div>
            {r.status === "accepted" && r.confirmed_amount ? <div className="text-xs text-faint">{t("confirmedAmount", { amount: formatMoney(r.confirmed_amount) })}</div> : null}
            {r.status === "rejected" && r.reject_reason ? <div className="text-xs text-danger">{t("reason", { reason: r.reject_reason })}</div> : null}
          </div>
          <ReviewDialog
            receipt={{ id: r.id, childName: canView.childName, subtitle: canView.subtitle(r), pending: false, toPay: 0 }}
            canReview={false}
            label={t("view")}
            variant="ghost"
          />
        </li>
      ))}
    </ul>
  );
}

/** Parent /payments: per child — amount due, requisites with «Скопировать», history (SPEC §5.9). */
export async function ParentPayments({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const items = await loadParentPayments(ctx);
  const today = todayIn(ctx.settings.timezone);
  if (!items.length) {
    return (
      <Card>
        <EmptyState icon={Wallet} title={t("noInvoices")} hint={t("noInvoicesHint")} />
      </Card>
    );
  }
  const tz = ctx.settings.timezone;
  return (
    <div className="space-y-4">
      {items.map(({ kid, latest, older, receipts }) => {
        const sub = (r: Receipt) => t("uploadedAt", { date: formatDateTime(r.created_at, tz) });
        const req = latest ? requisiteItems(ctx, t, paymentPurpose(ctx.settings.requisites?.purpose, kid.full_name, monthLabel(t, latest.period))) : [];
        return (
          <div key={kid.id} className="grid items-start gap-4 lg:grid-cols-[1fr_380px]" data-testid="parent-child-payments" data-child={kid.full_name}>
            <Card>
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={kid.full_name} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-bold">{kid.full_name}</div>
                  <div className="text-sm text-muted">{latest ? monthLabel(t, latest.period) : t("noInvoices")}</div>
                </div>
              </div>
              {latest ? (
                <>
                  <CurrentInvoice ctx={ctx} kid={kid} inv={latest} receipts={receipts} />
                  <ReceiptRows receipts={receipts.filter((r) => r.invoice_id === latest.id)} t={t} canView={{ childName: kid.full_name, subtitle: sub }} />
                </>
              ) : (
                <EmptyState icon={Wallet} title={t("noInvoices")} hint={t("noInvoicesHint")} className="py-6" />
              )}
            </Card>
            <div className="space-y-4">
              {latest && toPay(latest) > 0 ? (
                <Card>
                  <CardHeader title={t("requisites")} />
                  {req.length ? (
                    <Requisites items={req} />
                  ) : (
                    <p className="text-sm text-muted">{t("noRequisites")}</p>
                  )}
                </Card>
              ) : null}
              {older.length ? (
                <Card>
                  <CardHeader title={t("history")} />
                  <ul className="divide-y divide-border" data-testid="invoice-history">
                    {older.map((inv) => (
                      <li key={inv.id} className="py-3 first:pt-0 last:pb-0">
                        <Link href={`/payments/${inv.id}`} className="flex min-h-11 items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold">{monthLabel(t, inv.period)}</div>
                            <div className="text-sm text-muted tabular-nums">
                              {formatMoney(inv.amount)}
                              {inv.paid_amount > 0 ? ` · ${t("paid").toLowerCase()} ${formatMoney(inv.paid_amount)}` : ""}
                            </div>
                          </div>
                          <InvoiceStatusBadge status={displayStatus(inv, today, false)} />
                          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

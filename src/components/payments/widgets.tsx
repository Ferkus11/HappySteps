import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { ChevronRight, Inbox, PartyPopper } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { loadDebtors, loadMonth, loadPending } from "@/lib/payments-data";
import { collectedPercent, periodOf, totals } from "@/lib/payments";
import { formatDateTime, formatMoney, todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CurrentInvoice, loadParentPayments } from "./parent-view";
import { monthLabel } from "./month";

/** This month's totals and the debtors — loaded once per request for every payments card. */
const monthNumbers = cache(async (kgId: string, timezone: string) => {
  const supabase = await createClient();
  const today = todayIn(timezone);
  const [rows, debtors] = await Promise.all([loadMonth(supabase, kgId, periodOf(today.slice(0, 7))), loadDebtors(supabase, kgId)]);
  const sum = totals(rows);
  return { sum, percent: collectedPercent(sum), debt: debtors.reduce((s, d) => s + d.debt, 0), debtors, month: today.slice(0, 7) };
});

/** Owner top row: «Оплаты месяца» — paid % of accrued + total debt (red only when there is debt). */
async function OwnerPaymentsStat({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const n = await monthNumbers(ctx.kg.id, ctx.settings.timezone);
  return (
    <Link href="/payments?tab=month" className="block h-full">
      <Card className="flex h-full items-center justify-between gap-3 hover:shadow-md">
        <Stat
          value={<span className="text-[24px] whitespace-nowrap" data-testid="dash-payments-paid">{formatMoney(n.sum.paid)}</span>}
          label={t("widgets.month")}
          sub={
            <span className={n.debt > 0 ? "font-semibold text-danger" : undefined} data-testid="dash-payments" data-debt={n.debt}>
              {n.debt > 0 ? t("widgets.debts", { amount: formatMoney(n.debt) }) : t("widgets.noDebts")}
            </span>
          }
        />
        <Ring value={n.percent} color="var(--success)" label={t("widgets.paidOfAccrued")} />
      </Card>
    </Link>
  );
}

/** Accountant: «Чеки на проверке» — count + the oldest ones. */
async function PendingReceipts({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const supabase = await createClient();
  const list = await loadPending(supabase, ctx.kg.id, 50);
  return (
    <Card data-testid="receipts-pending" data-count={list.length}>
      <CardHeader title={t("widgets.pending")} href="/payments" />
      {list.length === 0 ? (
        <EmptyState icon={Inbox} title={t("queueEmpty")} className="py-4" />
      ) : (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[30px] leading-none font-extrabold" data-testid="receipts-pending-count">
              {list.length}
            </span>
            <span className="text-[13px] font-medium text-muted">{t("widgets.pendingCount", { count: list.length })}</span>
          </div>
          <ul className="space-y-1">
            {list.slice(0, 4).map((r) => (
              <li key={r.id}>
                <Link href={`/payments/${r.invoice_id}`} className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-muted">
                  <Avatar name={r.child.full_name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.child.full_name}</div>
                    <div className="truncate text-xs text-faint">
                      {monthLabel(t, r.invoice.period)} · {formatDateTime(r.created_at, ctx.settings.timezone)}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {/* Secondary: «Начать рабочий день» is the one primary action of the dashboard (SPEC §8). */}
          <Button asChild variant="secondary" className="mt-3 w-full">
            <Link href="/payments" data-testid="receipts-check">{t("check")}</Link>
          </Button>
        </>
      )}
    </Card>
  );
}

/** Accountant: «Начислено / оплачено» for the current month + debtors. */
async function AccruedPaid({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const n = await monthNumbers(ctx.kg.id, ctx.settings.timezone);
  return (
    <Card data-testid="accrued-paid">
      <CardHeader title={`${t("widgets.accruedPaid")} · ${monthLabel(t, n.month)}`} href="/payments?tab=month" />
      <div className="flex items-center justify-between gap-4">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
          <Stat value={<span className="text-[22px]">{formatMoney(n.sum.accrued)}</span>} label={t("accrued")} />
          <Stat value={<span className="text-[22px]">{formatMoney(n.sum.paid)}</span>} label={t("paid")} />
        </div>
        <Ring value={n.percent} color="var(--success)" label={t("widgets.paidOfAccrued")} />
      </div>
    </Card>
  );
}

/** Accountant: «Должники» — total debt and the biggest debts (red: debts are the one place for it, SPEC §8). */
async function DebtorsWidget({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const n = await monthNumbers(ctx.kg.id, ctx.settings.timezone);
  const top = [...n.debtors].sort((a, b) => b.debt - a.debt).slice(0, 4);
  return (
    <Card data-testid="dash-debtors" data-count={n.debtors.length}>
      <CardHeader title={t("tabs.debtors")} href="/payments?tab=debtors" />
      {n.debtors.length === 0 ? (
        <EmptyState icon={PartyPopper} title={t("widgets.noDebts")} className="py-4" />
      ) : (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[26px] leading-none font-extrabold whitespace-nowrap text-danger" data-testid="dash-debtors-total">
              {formatMoney(n.debt)}
            </span>
            <span className="text-[13px] font-medium text-muted">{t("widgets.debtors", { count: n.debtors.length })}</span>
          </div>
          <ul className="space-y-1">
            {top.map((d) => (
              <li key={d.invoice_id}>
                <Link href={`/payments/${d.invoice_id}`} className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-muted">
                  <Avatar name={d.full_name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.full_name}</span>
                  <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-danger">{formatMoney(d.debt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Parent: «Оплата» — amount, status, «Загрузить чек» for each child with an invoice. */
async function ParentPayment({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const items = (await loadParentPayments(ctx)).filter((x) => x.latest);
  if (!items.length) return null;
  return (
    <Card data-testid="parent-payment">
      <CardHeader title={t("widgets.parent")} href="/payments" />
      <div className="space-y-5">
        {items.map(({ kid, latest, receipts }) => (
          <div key={kid.id}>
            {items.length > 1 ? <div className="mb-2 text-sm font-bold">{kid.full_name}</div> : null}
            <CurrentInvoice ctx={ctx} kid={kid} inv={latest!} receipts={receipts} compact />
          </div>
        ))}
      </div>
    </Card>
  );
}

export const paymentsWidgets: DashboardWidget[] = [
  // Owner only: the head has payments read-only and no money in her top row (SPEC §6).
  { id: "payments-month", roles: ["owner"], slot: "stat", order: 30, wide: true, Component: OwnerPaymentsStat },
  { id: "payments-pending", roles: ["accountant"], slot: "main", order: 1, Component: PendingReceipts },
  { id: "payments-accrued", roles: ["accountant"], slot: "main", order: 2, Component: AccruedPaid },
  { id: "payments-debtors", roles: ["accountant"], slot: "main", order: 3, Component: DebtorsWidget },
  { id: "payments-parent", roles: ["parent"], slot: "main", order: 35, Component: ParentPayment },
];

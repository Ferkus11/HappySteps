import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/format";
import type { Invoice } from "@/lib/payments";
import { monthLabel } from "./month";

/** The statement of one invoice: charge (+ adjustment), carried debt/advance, paid. */
export async function InvoiceBreakdown({ inv, showAdjustment = true }: { inv: Invoice; showAdjustment?: boolean }) {
  const t = await getTranslations("payments");
  const adjusted = inv.adjusted_at && inv.amount !== inv.amount_original;
  return (
    <dl className="space-y-1.5 text-sm" data-testid="invoice-breakdown">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">{t("forMonth", { month: monthLabel(t, inv.period) })}</dt>
        <dd className="shrink-0 font-semibold tabular-nums" data-testid="invoice-amount">
          {formatMoney(inv.amount)}
        </dd>
      </div>
      {showAdjustment && adjusted ? (
        <p className="text-xs text-faint" data-testid="invoice-adjusted">
          {t("adjustedFrom", { amount: formatMoney(inv.amount_original), comment: inv.adjustment_comment ?? "" })}
        </p>
      ) : null}
      {inv.carried > 0 ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{t("carriedDebt")}</dt>
          <dd className="shrink-0 font-semibold text-danger tabular-nums" data-testid="invoice-carried-debt">
            +{formatMoney(inv.carried)}
          </dd>
        </div>
      ) : inv.carried < 0 ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{t("carriedAdvance")}</dt>
          <dd className="shrink-0 font-semibold text-success tabular-nums" data-testid="invoice-carried-advance">
            −{formatMoney(-inv.carried)}
          </dd>
        </div>
      ) : null}
      {inv.paid_amount > 0 ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{t("paid")}</dt>
          <dd className="shrink-0 font-semibold tabular-nums" data-testid="invoice-paid">
            −{formatMoney(inv.paid_amount)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

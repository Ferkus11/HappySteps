import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { latestInvoice } from "@/lib/payments-data";
import { advanceOf, statementStatus, toPay } from "@/lib/payments";
import { formatDate, formatMoney, todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InvoiceStatusBadge } from "./status-badge";
import { monthLabel } from "./month";

/** Small «Оплата» card on the child page: current balance and the latest invoice's status. */
export async function ChildPaymentCard({ ctx, childId }: { ctx: KgContext; childId: string }) {
  if (!["owner", "head", "accountant", "parent"].includes(ctx.role)) return null;
  const t = await getTranslations("payments");
  const supabase = await createClient();
  const inv = await latestInvoice(supabase, childId);
  if (!inv) return null;
  const status = statementStatus(inv, todayIn(ctx.settings.timezone));
  const href = ctx.role === "parent" ? "/payments" : `/payments/${inv.id}`;
  return (
    <Card data-testid="child-payment">
      <CardHeader title={t("title")} href={href} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("text-[26px] leading-none font-extrabold tabular-nums", status === "overdue" && "text-danger", advanceOf(inv) > 0 && "text-success")}>
            {advanceOf(inv) > 0 ? formatMoney(advanceOf(inv)) : formatMoney(toPay(inv))}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-muted">{advanceOf(inv) > 0 ? t("advance") : t("toPay")}</div>
        </div>
        <InvoiceStatusBadge status={status} className="shrink-0" />
      </div>
      <p className="mt-3 text-sm text-muted">
        <Link href={href} className="hover:text-brand">
          {monthLabel(t, inv.period)} · {t("payUntil", { date: formatDate(inv.due_date) })}
        </Link>
      </p>
    </Card>
  );
}

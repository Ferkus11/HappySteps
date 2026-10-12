import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { DisplayStatus, ReceiptStatus } from "@/lib/payments";

/** Red only for overdue debts and rejected receipts (SPEC §8). */
const tones = {
  unpaid: "neutral",
  overdue: "danger",
  review: "lavender",
  partial: "warning",
  rejected: "danger",
  paid: "success",
} as const;

export function InvoiceStatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  const t = useTranslations("payments");
  return (
    <Badge tone={tones[status]} className={className} data-testid="invoice-status" data-status={status}>
      {t(`status.${status}`)}
    </Badge>
  );
}

const receiptTones = { pending: "lavender", accepted: "success", rejected: "danger" } as const;

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const t = useTranslations("payments");
  return (
    <Badge tone={receiptTones[status]} data-testid="receipt-status" data-status={status}>
      {t(`receiptStatus.${status}`)}
    </Badge>
  );
}

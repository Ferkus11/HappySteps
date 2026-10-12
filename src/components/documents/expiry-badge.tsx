"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { expiryState } from "@/lib/documents-logic";
import { formatDate } from "@/lib/format";

/** «до 12.10.2026» / «истекает через N дней» / «истёк 01.10.2026». Red only for expired (an error state). */
export function ExpiryBadge({ expiresOn, today, showOk = true }: { expiresOn: string | null; today: string; showOk?: boolean }) {
  const t = useTranslations("documents");
  const s = expiryState(expiresOn, today);
  if (s.kind === "none") return null;
  if (s.kind === "expired")
    return (
      <Badge tone="danger" data-testid="expiry-badge" data-state="expired">
        {t("expired", { date: formatDate(expiresOn) })}
      </Badge>
    );
  if (s.kind === "soon")
    return (
      <Badge tone="warning" data-testid="expiry-badge" data-state="soon">
        {s.days === 0 ? t("expiresToday") : t("expiresIn", { count: s.days })}
      </Badge>
    );
  return showOk ? (
    <Badge tone="neutral" data-testid="expiry-badge" data-state="ok">
      {t("validUntil", { date: formatDate(expiresOn) })}
    </Badge>
  ) : null;
}

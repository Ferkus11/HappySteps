import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { STATUS_TONE, type WaitlistStatus } from "@/lib/waitlist";

export function WaitlistStatusBadge({ status, className }: { status: WaitlistStatus; className?: string }) {
  const t = useTranslations("waitlist.status");
  return (
    <Badge tone={STATUS_TONE[status]} className={className} data-testid="wl-status">
      {t(status)}
    </Badge>
  );
}

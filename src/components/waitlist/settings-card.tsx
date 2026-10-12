import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { Card, CardHeader } from "@/components/ui/card";
import { applyUrl } from "@/lib/waitlist-data";
import { FormLinkPanel } from "./form-link";

/** Settings section: link and QR code of the public application form (owner/head). */
export async function WaitlistFormCard() {
  const ctx = await requireKg(["owner", "head"]);
  const t = await getTranslations("waitlist");
  return (
    <Card data-testid="waitlist-settings">
      <CardHeader title={t("settingsTitle")} href="/waitlist" />
      <FormLinkPanel url={applyUrl(ctx.kg.slug)} fileName={`qr-${ctx.kg.slug}.png`} />
    </Card>
  );
}

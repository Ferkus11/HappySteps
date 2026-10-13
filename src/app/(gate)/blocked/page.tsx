import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LogoutButton } from "@/components/shell/logout-button";

export default async function BlockedPage() {
  const t = await getTranslations("auth");
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title={t("blockedTitle")}
        hint={t("blockedText")}
        action={<LogoutButton testId="blocked-logout" />}
      />
    </Card>
  );
}

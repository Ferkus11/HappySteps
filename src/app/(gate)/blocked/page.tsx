import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/session";

export default async function BlockedPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title={t("blockedTitle")}
        hint={t("blockedText")}
        action={
          <form action={logoutAction}>
            <Button variant="outline">{tc("logout")}</Button>
          </form>
        }
      />
    </Card>
  );
}

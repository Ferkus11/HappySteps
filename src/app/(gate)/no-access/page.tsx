import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/session";
import { loadContext } from "@/lib/auth/context";

export default async function NoAccessPage() {
  const r = await loadContext();
  if (r.state === "anonymous") redirect("/login");
  if (r.state === "ok") redirect("/");
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const archived = r.state === "no-access" && r.archived;
  return (
    <Card>
      <EmptyState
        icon={UserX}
        title={archived ? t("archivedTitle") : t("noAccess")}
        hint={archived ? t("archivedText") : undefined}
        action={
          <form action={logoutAction}>
            <Button variant="outline" data-testid="no-access-logout">{tc("logout")}</Button>
          </form>
        }
      />
    </Card>
  );
}

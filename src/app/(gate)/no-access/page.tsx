import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LogoutButton } from "@/components/shell/logout-button";
import { loadContext } from "@/lib/auth/context";

export default async function NoAccessPage() {
  const r = await loadContext();
  if (r.state === "anonymous") redirect("/login");
  if (r.state === "ok") redirect("/");
  const t = await getTranslations("auth");
  const archived = r.state === "no-access" && r.archived;
  return (
    <Card>
      <EmptyState
        icon={UserX}
        title={archived ? t("archivedTitle") : t("noAccess")}
        hint={archived ? t("archivedText") : undefined}
        action={<LogoutButton testId="no-access-logout" />}
      />
    </Card>
  );
}

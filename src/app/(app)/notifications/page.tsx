import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { requireAnyContext } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Stage 6 replaces this with the notification centre.
export default async function NotificationsPage() {
  await requireAnyContext();
  const t = await getTranslations("profile");
  return (
    <>
      <PageHeader title={t("notificationsTitle")} />
      <Card>
        <EmptyState icon={Bell} title={t("notificationsEmpty")} />
      </Card>
    </>
  );
}

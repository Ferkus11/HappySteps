import { getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listAnnouncements } from "@/lib/announcements";
import { publishTargets } from "@/lib/audience";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { AnnouncementDialog } from "@/components/announcements/announcement-dialog";

export async function generateMetadata() {
  return { title: (await getTranslations("announcements"))("title") };
}

export default async function AnnouncementsPage() {
  const ctx = await requireKg();
  const t = await getTranslations("announcements");
  const supabase = await createClient();
  const [items, targets] = await Promise.all([
    listAnnouncements(supabase, ctx, { withStats: ctx.role !== "parent" }),
    publishTargets(supabase, ctx),
  ]);
  const create = targets ? <AnnouncementDialog audiences={targets.audiences} groups={targets.groups} /> : null;
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={create} />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title={t("empty")} hint={targets ? t("emptyHintPublisher") : t("emptyHint")} />
        </Card>
      ) : (
        <ul className="grid gap-3" data-testid="announcements-list">
          {items.map((a) => (
            <li key={a.id}>
              <AnnouncementCard a={a} timezone={ctx.settings.timezone} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { listAnnouncements } from "@/lib/announcements";
import { Card, CardHeader } from "@/components/ui/card";
import { AnnouncementCard } from "./announcement-card";

const STAFF_AND_PARENTS: DashboardWidget["roles"] = ["accountant", "teacher", "club_teacher", "cook", "parent"];

/** "Важные объявления": hidden when there are none. */
async function ImportantAnnouncements({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const items = await listAnnouncements(supabase, ctx, { importantOnly: true, limit: 3 });
  if (!items.length) return null;
  const t = await getTranslations("announcements");
  return (
    <Card data-testid="important-announcements">
      <CardHeader title={t("importantWidget")} href="/announcements" />
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id}>
            <AnnouncementCard a={a} timezone={ctx.settings.timezone} compact />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const announcementsWidgets: DashboardWidget[] = [
  { id: "important-announcements", roles: ["owner", "head"], slot: "side", order: 10, phoneOrder: 15, Component: ImportantAnnouncements },
  { id: "important-announcements-main", roles: STAFF_AND_PARENTS, slot: "main", order: 30, Component: ImportantAnnouncements },
];

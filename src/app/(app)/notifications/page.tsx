import { getTranslations } from "next-intl/server";
import { requireAnyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadNotifications, unreadCount, unreadElsewhere } from "@/lib/notifications-data";
import { NotificationCentre } from "./centre";

export async function generateMetadata() {
  return { title: (await getTranslations("notifications"))("title") };
}

/** Notification centre (SPEC §5.12): history of the selected garden, newest first, grouped by day. */
export default async function NotificationsPage() {
  const ctx = await requireAnyContext();
  const supabase = await createClient();
  const [page, unread, elsewhere] = await Promise.all([loadNotifications(supabase, ctx), unreadCount(supabase, ctx), unreadElsewhere(supabase, ctx)]);
  const timeZone = ctx.kind === "kindergarten" ? ctx.settings.timezone : "Asia/Almaty";
  return <NotificationCentre items={page.items} more={page.more} unread={unread} elsewhere={elsewhere} timeZone={timeZone} />;
}

import { getTranslations } from "next-intl/server";
import { requireAnyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { typesForRoles } from "@/lib/notification-types";
import { disabledTypes } from "@/lib/notifications-data";
import { vapidPublicKey } from "@/lib/push";
import { formatTime } from "@/lib/format";
import { PushCard } from "./push-card";
import { PreferencesList } from "./preferences-list";

/**
 * Profile → «Уведомления»: push on this device + which types to receive. Preferences are personal and
 * apply in every garden, so the list covers the roles of all the person's gardens.
 */
export async function NotificationsProfileSection() {
  const ctx = await requireAnyContext();
  const t = await getTranslations("notifications.prefs");
  const supabase = await createClient();
  const types = typesForRoles(ctx.memberships.map((m) => m.role));
  const disabled = await disabledTypes(supabase, ctx.userId);
  const quiet =
    ctx.kind === "kindergarten" && ctx.settings.quiet_hours_start !== ctx.settings.quiet_hours_end
      ? { start: formatTime(ctx.settings.quiet_hours_start), end: formatTime(ctx.settings.quiet_hours_end) }
      : null;
  return (
    <Card id="notifications" data-testid="notifications-section" className="scroll-mt-24">
      <CardHeader title={t("title")} className="mb-2" />
      <p className="mb-4 text-sm text-muted">{t("hint")}</p>
      <PushCard publicKey={vapidPublicKey()} quiet={quiet} />
      {types.length ? (
        <>
          <h3 className="mt-5 mb-1 text-[13px] font-bold tracking-wide text-faint uppercase">{t("listTitle")}</h3>
          <PreferencesList types={types} disabled={disabled} />
        </>
      ) : null}
    </Card>
  );
}

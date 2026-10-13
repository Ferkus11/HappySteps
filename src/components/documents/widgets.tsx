import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { todayIn } from "@/lib/format";
import { listStaffDocuments } from "@/lib/documents";
import { ExpiryBadge } from "./expiry-badge";

// Owner/head: expiring staff documents are one line of «Требует внимания» (dashboard core widgets),
// not a separate card — the card only repeated that line.

/** Other staff: a small card only when one of their own documents expires within 30 days (or has expired). */
async function MyExpiringDocuments({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const docs = await listStaffDocuments(supabase, ctx.kg.id, { userId: ctx.userId, expiringFrom: today });
  if (!docs.length) return null;
  const t = await getTranslations("documents");
  return (
    <Card data-testid="my-expiring-documents">
      <CardHeader title={t("myExpiringWidget")} href="/documents" />
      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 truncate font-semibold">{d.title}</span>
            <ExpiryBadge expiresOn={d.expiresOn} today={today} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted">{t("myExpiringHint")}</p>
    </Card>
  );
}

export const documentsWidgets: DashboardWidget[] = [
  { id: "my-expiring-documents", roles: ["accountant", "teacher", "club_teacher", "cook"], slot: "main", order: 60, Component: MyExpiringDocuments },
];

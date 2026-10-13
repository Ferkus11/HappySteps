import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { todayIn } from "@/lib/format";
import { listStaffDocuments } from "@/lib/documents";
import { ExpiryBadge } from "./expiry-badge";

/** Owner/head: «Истекающие документы» — expired or expiring within 30 days; hidden when there are none. */
async function ExpiringDocuments({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const docs = await listStaffDocuments(supabase, ctx.kg.id, { expiringFrom: today });
  if (!docs.length) return null;
  const t = await getTranslations("documents");
  return (
    <Card data-testid="expiring-documents">
      <CardHeader title={t("expiringWidget")} href="/documents?tab=staff&filter=expiring" />
      <ul className="space-y-1">
        {docs.slice(0, 5).map((d) => (
          <li key={d.id}>
            <Link href={`/documents/staff/${d.userId}`} className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-muted">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{d.personName}</span>
                <span className="block truncate text-[13px] text-muted">{d.title}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap">
                <ExpiryBadge expiresOn={d.expiresOn} today={today} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {docs.length > 5 ? <p className="mt-2 text-sm text-muted">{t("andMore", { count: docs.length - 5 })}</p> : null}
    </Card>
  );
}

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
  { id: "expiring-documents", roles: ["owner", "head"], slot: "main", order: 60, wide: true, Component: ExpiringDocuments },
  { id: "my-expiring-documents", roles: ["accountant", "teacher", "club_teacher", "cook"], slot: "main", order: 60, Component: MyExpiringDocuments },
];

import { getTranslations } from "next-intl/server";
import { Building2 } from "lucide-react";
import { requireSuperadmin } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { CreateKindergarten, KindergartenRowActions } from "./client";

export async function generateMetadata() {
  return { title: (await getTranslations("admin"))("title") };
}

interface Row {
  id: string;
  name: string;
  slug: string;
  status: "active" | "blocked";
  created_at: string;
  owner_name: string | null;
  owner_phone: string | null;
  children_count: number;
  staff_count: number;
  plan: string | null;
  subscription_status: "trial" | "active" | "past_due" | "blocked" | null;
  current_period_end: string | null;
}

export default async function AdminPage() {
  await requireSuperadmin();
  const t = await getTranslations("admin");
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_kindergartens");
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<CreateKindergarten />} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title={t("empty")} hint={t("emptyHint")} />
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((k) => (
            <Card key={k.id} className="flex flex-col gap-4 md:flex-row md:items-center" data-testid={`kg-row-${k.slug}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-bold">{k.name}</span>
                  <Badge tone={k.status === "active" ? "success" : "danger"}>
                    {k.status === "active" ? t("statusActive") : t("statusBlocked")}
                  </Badge>
                  {k.subscription_status ? <Badge tone="sky">{t(`subscriptionStatus.${k.subscription_status}`)}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {t("owner")}: {k.owner_name ?? "—"} {k.owner_phone ? `· ${formatPhone(k.owner_phone)}` : ""}
                </p>
              </div>
              <dl className="grid grid-cols-4 gap-4 text-sm md:w-[420px]">
                <div>
                  <dt className="text-xs text-faint">{t("children")}</dt>
                  <dd className="font-bold">{k.children_count}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">{t("staff")}</dt>
                  <dd className="font-bold">{k.staff_count}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">{t("createdAt")}</dt>
                  <dd className="font-bold">{formatDate(k.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">{t("subscriptionUntil")}</dt>
                  <dd className="font-bold">{k.current_period_end ? formatDate(k.current_period_end) : "—"}</dd>
                </div>
              </dl>
              <KindergartenRowActions
                id={k.id}
                status={k.status}
                plan={k.plan ?? "trial"}
                subStatus={k.subscription_status ?? "trial"}
                periodEnd={k.current_period_end}
              />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

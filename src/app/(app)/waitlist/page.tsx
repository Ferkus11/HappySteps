import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight, ListOrdered } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ageOn, formatDate, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WAITLIST_COLUMNS, applyUrl, waitlistCounts, type WaitlistRow } from "@/lib/waitlist-data";
import { WAITLIST_TABS, statusesOf, shortName, type WaitlistTab } from "@/lib/waitlist";
import { WaitlistStatusBadge } from "@/components/waitlist/status-badge";
import { AddApplicationButton } from "@/components/waitlist/add-application";
import { FormLinkButton } from "@/components/waitlist/form-link";

export async function generateMetadata() {
  return { title: (await getTranslations("waitlist"))("title") };
}

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant"]);
  const sp = await searchParams;
  const tab: WaitlistTab = WAITLIST_TABS.includes(sp.tab as WaitlistTab) ? (sp.tab as WaitlistTab) : "waiting";
  const t = await getTranslations("waitlist");
  const tch = await getTranslations("children");
  const supabase = await createClient();
  const [counts, { data }] = await Promise.all([
    waitlistCounts(supabase, ctx.kg.id),
    supabase
      .from("waitlist_applications")
      .select(WAITLIST_COLUMNS)
      .eq("kindergarten_id", ctx.kg.id)
      .in("status", statusesOf(tab))
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const rows = (data ?? []) as WaitlistRow[];
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const today = todayIn(ctx.settings.timezone);
  const tabCount = (tab: WaitlistTab) => statusesOf(tab).reduce((s, st) => s + counts[st], 0);
  const total = tabCount("all");

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          isAdmin ? (
            <>
              <FormLinkButton url={applyUrl(ctx.kg.slug)} fileName={`qr-${ctx.kg.slug}.png`} />
              <AddApplicationButton today={today} />
            </>
          ) : null
        }
      />
      <nav className="scrollbar-none edge-fade-x -mx-4 mb-4 flex scroll-px-4 gap-1.5 overflow-x-auto px-4 md:mx-0 md:scroll-px-0 md:px-0 md:[mask-image:none]" aria-label={t("title")}>
        {WAITLIST_TABS.map((key) => (
          <Link
            key={key}
            href={key === "waiting" ? "/waitlist" : `/waitlist?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold",
              tab === key ? "bg-text text-white" : "border border-border bg-surface text-muted",
            )}
            data-testid={`wl-tab-${key}`}
          >
            {t(`tabs.${key}`)}
            <span className={cn("text-xs", tab === key ? "text-white/70" : "text-faint")}>{tabCount(key)}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ListOrdered} title={total === 0 ? t("empty") : t("emptyFiltered")} hint={total === 0 && isAdmin ? t("emptyHint") : undefined} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/waitlist/${r.id}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5"
                  data-testid="wl-row"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span data-user-content className="truncate font-bold">{r.child_name}</span>
                    </div>
                    <div className="truncate text-sm text-muted">
                      {tch("age", { count: ageOn(r.child_birth_date, today) })}
                      {r.desired_date ? ` · ${t("desiredFrom", { date: formatDate(r.desired_date) })}` : ""}
                      {` · ${shortName(r.parent_name)}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <WaitlistStatusBadge status={r.status} />
                    <span className="text-xs text-faint">{formatDate(r.created_at, ctx.settings.timezone)}</span>
                  </div>
                  <ChevronRight className="hidden size-4 shrink-0 text-faint sm:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

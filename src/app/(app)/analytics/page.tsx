import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { comparison, isSection, parsePeriodChecked, sectionsFor, type PeriodParams } from "@/lib/analytics";
import { periodLabel, rangeLabel, type T } from "@/lib/analytics-view";
import { formatDate, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { PeriodPicker, SectionTabs } from "@/components/analytics/ui";
import { AnalyticsSection } from "@/components/analytics/sections";
import { SectionSkeleton } from "@/components/analytics/skeleton";

export async function generateMetadata() {
  return { title: (await getTranslations("analytics"))("title") };
}

/**
 * SPEC §7 «Аналитика», §3.4: owner — all four sections; head — without finances; accountant — finances only.
 * The SQL functions check the same rules, so a hand-made URL cannot reach a forbidden section.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<PeriodParams & { tab?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant"]);
  const sp = await searchParams;
  const tabs = sectionsFor(ctx.role);
  const tab = isSection(sp.tab) && tabs.includes(sp.tab) ? sp.tab : tabs[0];
  const today = todayIn(ctx.settings.timezone);
  const { period, problem } = parsePeriodChecked(sp, today);
  const { cur, prev, running } = comparison(period, today);
  const t = (await getTranslations("analytics")) as unknown as T;
  const supabase = await createClient();
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs t={t} tabs={tabs} active={tab} period={period} />
      <PeriodPicker t={t} tab={tab} period={period} label={periodLabel(t, period)} today={today} problem={problem} />
      {cur.from <= today ? (
        <p className="-mt-2 mb-4 px-1 text-xs text-faint" data-testid="period-compare">
          {running ? `${t("period.running", { date: formatDate(today) })}. ` : ""}
          {t("period.compare", { range: rangeLabel(prev) })}
        </p>
      ) : null}
      <Suspense key={`${tab}:${period.kind}:${period.from}:${period.to}`} fallback={<SectionSkeleton />}>
        <AnalyticsSection section={tab} supabase={supabase} kgId={ctx.kg.id} t={t} period={period} cur={cur} prev={prev} today={today} />
      </Suspense>
    </>
  );
}

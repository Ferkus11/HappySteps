import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { loadDays } from "@/lib/queries/worktime";
import { tileCounts } from "@/lib/worktime";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { WorkdayCard } from "./workday-card";
import { WorktimeTiles } from "./status-tiles";

/** Owner/head (and accountant, view only): today's work-time tiles. */
async function WorktimeTodayWidget({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("worktime");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const rows = await loadDays(supabase, ctx.kg.id, today, today);
  return (
    <Card>
      <CardHeader title={t("title")} href="/worktime" />
      <WorktimeTiles counts={tileCounts(rows)} href={(s) => `/worktime?status=${s}`} />
      <div className="mt-3 flex justify-end">
        <Link href="/worktime" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand hover:underline" data-testid="worktime-staff-list">
          <Users className="size-4" aria-hidden /> {t("staffList")}
        </Link>
      </div>
    </Card>
  );
}

export const worktimeWidgets: DashboardWidget[] = [
  // Owner only if they have a schedule (WorkdayCard returns null otherwise).
  { id: "worktime-day", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook"], slot: "top", order: 10, Component: WorkdayCard },
  { id: "worktime-today", roles: ["owner", "head", "accountant"], slot: "main", order: 10, wide: true, Component: WorktimeTodayWidget },
];

import { getTranslations } from "next-intl/server";
import { CalendarOff, UtensilsCrossed } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isWorkingDayDb, loadPortions } from "@/lib/attendance";
import { todayIn } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Portions for the kitchen (SPEC §5.3): active − reported before marking, actual number after.
 * Numbers only — the cook never sees child names (expected_portions is a security definer function).
 */
export async function PortionsCard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("attendance");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const [working, rows] = await Promise.all([isWorkingDayDb(supabase, ctx.kg.id, today), loadPortions(supabase, ctx.kg.id, today)]);
  const total = rows.reduce((s, r) => s + r.expected, 0);
  const groups = rows.filter((r) => r.active > 0);
  return (
    <Card data-testid="portions-card">
      <CardHeader title={t("portionsTitle")} />
      {!working ? (
        <EmptyState icon={CalendarOff} title={t("dayOff")} hint={t("portionsDayOff")} className="py-6" />
      ) : !groups.length ? (
        <EmptyState icon={UtensilsCrossed} title={t("noChildren")} className="py-6" />
      ) : (
        <>
          <div className="mb-4 flex items-end gap-3">
            <div className="text-[40px] leading-none font-extrabold tracking-tight" data-testid="portions-total">
              {total}
            </div>
            <div className="pb-1 text-[13px] font-medium text-muted">{t("portionsTotal")}</div>
          </div>
          <ul className="divide-y divide-border">
            {groups.map((r) => {
              return (
                <li key={r.group_id} className="flex min-h-14 items-center gap-3 py-2" data-testid="portions-group" data-group={r.group_name}>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.group_name}</div>
                    <div className="text-xs text-muted">
                      {r.marked > 0
                        ? r.unmarked === 0
                          ? t("portionsMarked")
                          : t("portionsPartly", { marked: r.active - r.unmarked, total: r.active })
                        : r.reported > 0
                          ? t("portionsReported", { count: r.reported })
                          : t("portionsNotMarked")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[22px] leading-none font-extrabold" data-testid="portions-expected">
                      {r.expected}
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">{t("ofActive", { total: r.active })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

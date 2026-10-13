import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Cake, CalendarDays } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, todayIn } from "@/lib/format";
import { birthdays, upcomingEvents } from "@/lib/events-data";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { KIND_STYLE, timeRange } from "@/lib/events";


async function UpcomingEvents({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("events");
  const tc = await getTranslations("common");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const tomorrow = addDays(today, 1);
  const items = await upcomingEvents(supabase, ctx, today, 4);
  return (
    <Card className="@container" data-testid="upcoming-events">
      <CardHeader title={t("upcoming")} href="/events" />
      {items.length ? (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id}>
              <Link href={`/events?month=${e.date.slice(0, 7)}&day=${e.date}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-muted" data-testid="upcoming-event">
                <span className="grid w-12 shrink-0 place-items-center rounded-xl bg-surface-muted py-1.5 text-center">
                  <span className="text-lg leading-none font-extrabold">{Number(e.date.slice(8))}</span>
                  <span className="text-[11px] text-muted">{e.date.slice(5, 7)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span data-user-content className="block truncate text-sm font-bold">{e.title}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {[e.date === today ? tc("today") : e.date === tomorrow ? tc("tomorrow") : formatDate(e.date), timeRange(e)].filter(Boolean).join(" · ")}
                    {e.place ? (
                      <>
                        {" · "}
                        <span data-user-content>{e.place}</span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className={cn("hidden shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold @md:inline", KIND_STYLE[e.kind])}>{t(`kinds.${e.kind}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={CalendarDays} title={t("noUpcoming")} className="py-6" />
      )}
    </Card>
  );
}

/** "Дни рождения на этой неделе" (today + 6 days); hidden when there are none. */
async function BirthdaysWeek({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const list = await birthdays(supabase, ctx, today, addDays(today, 6));
  if (!list.length) return null;
  const t = await getTranslations("events");
  const tc = await getTranslations("common");
  return (
    <Card data-testid="birthdays-week">
      <CardHeader title={t("birthdaysWeek")} href={`/events?month=${today.slice(0, 7)}`} />
      <ul className="space-y-1.5">
        {list.map((b) => (
          <li key={`${b.kind}-${b.person_id}-${b.day}`} className="flex min-h-11 items-center gap-3 text-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Cake className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span data-user-content className="block truncate font-semibold">{b.full_name}</span>
              <span className="block truncate text-[13px] text-muted">
                {b.kind === "child" ? t("turnsChild", { age: b.age ?? 0 }) : t("staffBirthday")}
                {b.group_name ? (
  <>
    {" · "}
    <span data-user-content>{b.group_name}</span>
  </>
) : null}
              </span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-muted">{b.day === today ? tc("today") : formatDate(b.day).slice(0, 5)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const eventsWidgets: DashboardWidget[] = [
  { id: "upcoming-events", roles: ["owner", "head", "teacher", "parent"], slot: "main", order: 40, Component: UpcomingEvents },
  { id: "birthdays-week", roles: ["teacher"], slot: "main", order: 35, Component: BirthdaysWeek },
];

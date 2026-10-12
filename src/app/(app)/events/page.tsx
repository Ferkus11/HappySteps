import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { publishTargets } from "@/lib/audience";
import { todayIn } from "@/lib/format";
import { isDay, isMonth, monthGrid } from "@/lib/events";
import { birthdays, daysOff, listEvents, upcomingEvents } from "@/lib/events-data";
import { PageHeader } from "@/components/ui/page-header";
import { EventsCalendar } from "@/components/events/calendar";

export async function generateMetadata() {
  return { title: (await getTranslations("events"))("title") };
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const ctx = await requireKg();
  const sp = await searchParams;
  const t = await getTranslations("events");
  const today = todayIn(ctx.settings.timezone);
  const day = isDay(sp.day) ? sp.day : null;
  const month = isMonth(sp.month) ? sp.month : (day ?? today).slice(0, 7);
  const initialDay = day && day.startsWith(month) ? day : today.startsWith(month) ? today : `${month}-01`;
  const weeks = monthGrid(month);
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  const supabase = await createClient();
  const [events, bdays, off, upcoming, targets] = await Promise.all([
    listEvents(supabase, ctx, from, to),
    birthdays(supabase, ctx, from, to),
    daysOff(supabase, ctx, from, to),
    upcomingEvents(supabase, ctx, today, 6),
    publishTargets(supabase, ctx),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <EventsCalendar
        key={`${month}-${initialDay}`}
        month={month}
        today={today}
        initialDay={initialDay}
        events={events}
        birthdays={bdays}
        daysOff={off}
        upcoming={upcoming}
        targets={targets}
      />
    </>
  );
}

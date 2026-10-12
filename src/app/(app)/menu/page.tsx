import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DayMenuCard } from "@/components/menu/day-menu";
import { canEditMenu, loadMenus } from "@/components/menu/data";
import { enabledMeals } from "@/components/menu/meals";

export async function generateMetadata() {
  return { title: (await getTranslations("menu"))("title") };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireKg();
  const t = await getTranslations("menu");
  const today = todayIn(ctx.settings.timezone);
  const { date } = await searchParams;
  const start = date && ISO.test(date) && !Number.isNaN(Date.parse(date)) ? date : today;
  const dates = [start, addDays(start, 1)];
  const supabase = await createClient();
  const menus = await loadMenus(supabase, ctx.kg.id, dates);
  const meals = enabledMeals(ctx.settings.meals);
  const canEdit = canEditMenu(ctx.role);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex items-center gap-1" data-testid="menu-nav">
            <Button asChild variant="outline" size="icon" aria-label={t("prevDay")}>
              <Link href={`/menu?date=${addDays(start, -1)}`} data-testid="menu-prev">
                <ChevronLeft />
              </Link>
            </Button>
            {start !== today ? (
              <Button asChild variant="outline">
                <Link href="/menu">{t("toToday")}</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="icon" aria-label={t("nextDay")}>
              <Link href={`/menu?date=${addDays(start, 1)}`} data-testid="menu-next">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {dates.map((d) => (
          <DayMenuCard key={d} menu={menus[d]} meals={meals} today={today} canEdit={canEdit} />
        ))}
      </div>
    </>
  );
}

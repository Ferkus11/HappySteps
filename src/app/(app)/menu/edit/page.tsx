import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { MENU_EDITORS, loadMenus, recentMenuDates } from "@/components/menu/data";
import { dayTitle } from "@/components/menu/day-menu";
import { enabledMeals } from "@/components/menu/meals";
import { MenuEditor } from "@/components/menu/menu-editor";

export async function generateMetadata() {
  return { title: (await getTranslations("menu"))("editTitle") };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function MenuEditPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  // Page guard is a UI convenience; actions and RLS enforce owner/head/cook again.
  const ctx = await requireKg(MENU_EDITORS);
  const t = await getTranslations("menu");
  const today = todayIn(ctx.settings.timezone);
  const { date: wanted } = await searchParams;
  const date = wanted && ISO.test(wanted) && !Number.isNaN(Date.parse(wanted)) ? wanted : today;
  const supabase = await createClient();
  const [menus, recent] = await Promise.all([loadMenus(supabase, ctx.kg.id, [date]), recentMenuDates(supabase, ctx.kg.id, date)]);
  const menu = menus[date];
  const meals = enabledMeals(ctx.settings.meals);
  return (
    <>
      <Link href={`/menu?date=${date}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-text">
        <ChevronLeft className="size-4" /> {t("backToMenu")}
      </Link>
      <PageHeader title={t("editTitle")} description={await dayTitle(date, today)} />
      <MenuEditor
        key={`${date}:${menu.updatedAt ?? ""}`}
        date={date}
        dateLabel={formatDate(date)}
        meals={meals}
        items={menu.items}
        recent={recent.map((d) => ({ date: d, label: formatDate(d) }))}
      />
    </>
  );
}

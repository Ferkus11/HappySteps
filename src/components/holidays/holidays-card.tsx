import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { todayIn } from "@/lib/format";
import { HolidaysEditor } from "./holidays-editor";

/** Settings section: kindergarten days off (owner/head). */
export async function HolidaysCard() {
  const ctx = await requireKg(["owner", "head"]);
  const t = await getTranslations("holidays");
  const year = Number(todayIn(ctx.settings.timezone).slice(0, 4));
  const supabase = await createClient();
  const { data } = await supabase
    .from("holidays")
    .select("id, date, name, kind")
    .eq("kindergarten_id", ctx.kg.id)
    .gte("date", `${year}-01-01`)
    .lte("date", `${year + 1}-12-31`)
    .order("date");
  return (
    <Card className="xl:col-span-2">
      <CardHeader title={t("title")} />
      <p className="-mt-2 mb-4 text-sm text-muted">{t("hint")}</p>
      <HolidaysEditor year={year} items={(data ?? []) as { id: string; date: string; name: string; kind: "holiday" | "day_off" | "working_day" }[]} />
    </Card>
  );
}

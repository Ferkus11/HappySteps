import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { groupSummaries } from "@/lib/queries/groups";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Greeting } from "./greeting";

export async function AdminDashboard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard");
  const supabase = await createClient();
  const [groups, { count: staffCount }] = await Promise.all([
    groupSummaries(supabase, ctx.kg.id),
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("kindergarten_id", ctx.kg.id).eq("status", "active").neq("role", "parent"),
  ]);
  const children = groups.reduce((s, g) => s + g.activeCount, 0);
  const capacity = groups.reduce((s, g) => s + g.capacity, 0);
  return (
    <>
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/children">
          <Card className="h-full hover:shadow-md">
            <Stat value={<span data-testid="dash-children">{children}</span>} label={t("children")} sub={t("activeChildren")} />
          </Card>
        </Link>
        <Link href="/groups">
          <Card className="flex h-full items-center justify-between hover:shadow-md">
            <Stat value={groups.length} label={t("groups")} sub={t("fill")} />
            <Ring value={capacity ? (children / capacity) * 100 : 0} />
          </Card>
        </Link>
        <Link href="/staff">
          <Card className="h-full hover:shadow-md">
            <Stat value={staffCount ?? 0} label={t("staff")} />
          </Card>
        </Link>
      </div>
    </>
  );
}

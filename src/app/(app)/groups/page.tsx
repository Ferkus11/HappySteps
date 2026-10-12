import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { UsersRound } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { groupSummaries, listTeachers } from "@/lib/queries/groups";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Ring } from "@/components/ui/ring";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { GroupDialog } from "./group-dialog";

export async function generateMetadata() {
  return { title: (await getTranslations("groups"))("title") };
}

export default async function GroupsPage() {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher"]);
  const t = await getTranslations("groups");
  const supabase = await createClient();
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const [all, teachers] = await Promise.all([groupSummaries(supabase, ctx.kg.id), isAdmin ? listTeachers(supabase, ctx.kg.id) : []]);
  const groups = ctx.role === "teacher" ? all.filter((g) => g.teachers.some((x) => x.id === ctx.userId)) : all;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={isAdmin ? <GroupDialog teachers={teachers} /> : null} />
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={UsersRound} title={t("empty")} hint={isAdmin ? t("emptyHint") : undefined} action={isAdmin ? <GroupDialog teachers={teachers} /> : null} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => {
            const pct = (g.activeCount / g.capacity) * 100;
            return (
              <Link key={g.id} href={`/groups/${g.id}`} className="block" data-testid={`group-${g.name}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden />
                        <h2 className="truncate text-[17px] font-extrabold">{g.name}</h2>
                      </div>
                      {g.age_category ? <p className="mt-1 text-sm text-muted">{g.age_category}</p> : null}
                    </div>
                    <Ring value={pct} color={pct > 100 ? "var(--danger)" : g.color} size={58} stroke={6} />
                  </div>
                  <div className="mt-4 text-[26px] leading-none font-extrabold">
                    {g.activeCount}
                    <span className="text-base font-semibold text-faint"> / {g.capacity}</span>
                  </div>
                  {pct > 100 ? (
                    <Badge tone="danger" className="mt-2">
                      {t("overCapacity")}
                    </Badge>
                  ) : null}
                  <p className="mt-3 truncate text-sm text-muted">{g.teachers.map((x) => x.name).join(", ") || t("noTeachers")}</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

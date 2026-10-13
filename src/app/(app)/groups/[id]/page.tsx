import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Baby } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { groupSummaries, listTeachers } from "@/lib/queries/groups";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Ring } from "@/components/ui/ring";
import { ageOn, todayIn } from "@/lib/format";
import { GroupDialog } from "../group-dialog";
import { DeleteGroup, TransferGroup } from "./client";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg(["owner", "head", "accountant", "teacher"]);
  const t = await getTranslations("groups");
  const tch = await getTranslations("children");
  const supabase = await createClient();
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const [groups, teachers, { data: children }] = await Promise.all([
    groupSummaries(supabase, ctx.kg.id),
    isAdmin ? listTeachers(supabase, ctx.kg.id) : Promise.resolve([]),
    supabase.from("children").select("id, full_name, birth_date, allergies").eq("group_id", id).eq("status", "active").order("full_name"),
  ]);
  const g = groups.find((x) => x.id === id);
  if (!g) notFound();
  if (ctx.role === "teacher" && !g.teachers.some((x) => x.id === ctx.userId)) notFound();
  const today = todayIn(ctx.settings.timezone);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="size-3.5 rounded-full" style={{ background: g.color }} aria-hidden />
            <span data-user-content>{g.name}</span>
          </span>
        }
        description={g.age_category ? <span data-user-content>{g.age_category}</span> : undefined}
        actions={
          isAdmin ? (
            <>
              <GroupDialog teachers={teachers} group={{ id: g.id, name: g.name, age_category: g.age_category, capacity: g.capacity, color: g.color, teacherIds: g.teachers.map((x) => x.id) }} />
              <TransferGroup fromId={g.id} groups={groups.filter((x) => x.id !== g.id).map((x) => ({ id: x.id, name: x.name }))} today={today} />
              <DeleteGroup id={g.id} />
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-0">
          <div className="px-5 pt-5">
            <CardHeader title={t("children")} />
          </div>
          {children?.length ? (
            <ul className="divide-y divide-border">
              {children.map((c) => (
                <li key={c.id}>
                  <Link href={`/children/${c.id}`} className="flex min-h-14 items-center gap-3 px-5 py-2.5 hover:bg-surface-muted">
                    <Avatar name={c.full_name} size={36} />
                    <span data-user-content className="min-w-0 flex-1 truncate font-semibold">{c.full_name}</span>
                    <span className="text-sm text-muted">{tch("age", { count: ageOn(c.birth_date, today) })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Baby} title={t("noChildren")} />
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[30px] leading-none font-extrabold">
                {g.activeCount}
                <span className="text-base text-faint"> / {g.capacity}</span>
              </div>
              <div className="mt-1.5 text-sm text-muted">{t("capacity")}</div>
            </div>
            <Ring value={(g.activeCount / g.capacity) * 100} color={g.color} />
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 text-xs font-semibold text-faint">{t("teachers")}</div>
            {g.teachers.length ? (
              <ul className="space-y-2">
                {g.teachers.map((x) => (
                  <li key={x.id} className="flex items-center gap-2.5 text-sm font-semibold">
                    <Avatar name={x.name} size={32} /> <span data-user-content>{x.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("noTeachers")}</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

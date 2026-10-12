import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups, listStaff, isActivePerson } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/format";
import { canManageRole } from "@/lib/auth/roles";
import { PersonActions } from "@/components/common/person-actions";
import { EditPerson, TeacherGroups } from "./client";

export default async function StaffCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg(["owner", "head", "accountant"]);
  const t = await getTranslations("staff");
  const tr = await getTranslations("roles");
  const tc = await getTranslations("common");
  const supabase = await createClient();
  const [people, groups] = await Promise.all([listStaff(supabase, ctx.kg.id), listGroups(supabase, ctx.kg.id)]);
  const p = people.find((x) => x.userId === id);
  if (!p) notFound();
  const actorRole = ctx.roles.includes("owner") ? "owner" : ctx.roles.includes("head") ? "head" : null;
  const canManage = !!actorRole && p.userId !== ctx.userId && p.roles.some((r) => canManageRole(actorRole, r.role));
  const active = isActivePerson(p);
  const isTeacher = p.roles.some((r) => r.role === "teacher" && r.status === "active");

  return (
    <>
      <PageHeader title={t("card")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="flex items-start gap-4">
            <Avatar name={p.fullName} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-extrabold" data-testid="person-name">{p.fullName}</h2>
              <p className="mt-0.5 text-muted">{formatPhone(p.phone)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.roles.map((r) => (
                  <Badge key={r.membershipId} tone={r.status === "active" ? "sky" : "neutral"}>
                    {tr(r.role)}
                    {r.position ? ` · ${r.position}` : ""}
                    {r.status === "archived" ? ` · ${tc("archived")}` : ""}
                  </Badge>
                ))}
                {!p.activated ? <Badge tone="warning">{t("notActivated")}</Badge> : null}
              </div>
            </div>
            {canManage ? (
              <EditPerson
                userId={p.userId}
                fullName={p.fullName}
                birthDate={p.birthDate}
                position={p.roles.find((r) => r.position)?.position ?? ""}
              />
            ) : null}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
            <div>
              <dt className="text-xs text-faint">{t("birthDate")}</dt>
              <dd className="font-semibold">{p.birthDate ? formatDate(p.birthDate) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">{t("groups")}</dt>
              <dd className="font-semibold">{p.groups.map((g) => g.name).join(", ") || "—"}</dd>
            </div>
          </dl>
          <div className="mt-5">
            <PersonActions
              userId={p.userId}
              name={p.fullName}
              active={active}
              activated={p.activated}
              canManage={canManage}
              canDelete={ctx.roles.includes("owner") && p.userId !== ctx.userId}
              kindergartenName={ctx.kg.name}
              afterDelete="/staff"
            />
          </div>
        </Card>
        {isTeacher ? (
          <Card>
            <CardHeader title={t("groups")} />
            {canManage ? (
              <TeacherGroups userId={p.userId} groups={groups.map((g) => ({ id: g.id, name: g.name }))} selected={p.groups.map((g) => g.id)} />
            ) : (
              <p className="text-sm text-muted">{p.groups.map((g) => g.name).join(", ") || t("noGroups")}</p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

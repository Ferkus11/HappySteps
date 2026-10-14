import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Contact } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups, listStaff, isActivePerson } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhone } from "@/lib/phone";
import { AddStaffButton } from "./add-staff";
import { STAFF_ROLES } from "@/lib/auth/roles";

export async function generateMetadata() {
  return { title: (await getTranslations("staff"))("title") };
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant"]);
  const { tab } = await searchParams;
  const archive = tab === "archive";
  const t = await getTranslations("staff");
  const tr = await getTranslations("roles");
  const supabase = await createClient();
  const [people, groups] = await Promise.all([listStaff(supabase, ctx.kg.id), listGroups(supabase, ctx.kg.id)]);
  const shown = people.filter((p) => (archive ? !isActivePerson(p) : isActivePerson(p)));
  const canAdd = ctx.role === "owner" || ctx.role === "head";
  const allowedRoles = ctx.role === "owner" ? STAFF_ROLES : STAFF_ROLES.filter((r) => ["teacher", "club_teacher", "cook"].includes(r));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={canAdd ? <AddStaffButton roles={allowedRoles} groups={groups.map((g) => ({ id: g.id, name: g.name }))} /> : null}
      />
      <div className="mb-4 inline-flex gap-1 rounded-2xl bg-surface-muted p-1">
        <Link href="/staff" className={`flex h-10 pointer-coarse:h-11 items-center rounded-xl px-4 text-sm font-semibold ${!archive ? "bg-surface shadow-sm" : "text-muted"}`}>
          {t("active")}
        </Link>
        <Link href="/staff?tab=archive" className={`flex h-10 pointer-coarse:h-11 items-center rounded-xl px-4 text-sm font-semibold ${archive ? "bg-surface shadow-sm" : "text-muted"}`}>
          {t("archive")}
        </Link>
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={Contact} title={archive ? t("emptyArchive") : t("empty")} hint={archive ? undefined : t("emptyHint")} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {shown.map((p) => {
              const roles = p.roles.filter((r) => (archive ? r.status === "archived" : r.status === "active"));
              return (
              <li key={p.userId}>
                <Link href={`/staff/${p.userId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5" data-testid={`staff-${p.phone}`}>
                  <Avatar name={p.fullName} />
                  <div className="min-w-0 flex-1">
                    <div data-user-content className="truncate font-bold">{p.fullName}</div>
                    <div className="truncate text-sm text-muted">
                      {roles.length ? (
                        // Phones: the role badges on the right are hidden, so the role leads the sub-line.
                        <span className="font-semibold text-sky-strong sm:hidden" data-testid="staff-role-mobile">
                          {roles.map((r) => tr(r.role)).join(", ")}
                          {" · "}
                        </span>
                      ) : null}
                      <span className="whitespace-nowrap">{formatPhone(p.phone)}</span>
                      {p.groups.length ? (
                        <>
                          {" · "}
                          <span data-user-content>{p.groups.map((g) => g.name).join(", ")}</span>
                        </>
                      ) : null}
                    </div>
                    {!p.activated ? (
                      <Badge tone="warning" className="mt-1.5 sm:hidden">
                        {t("notActivated")}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                    {roles.map((r) => (
                      <Badge key={r.membershipId} tone="sky">
                        {tr(r.role)}
                      </Badge>
                    ))}
                    {!p.activated ? <Badge tone="warning">{t("notActivated")}</Badge> : null}
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

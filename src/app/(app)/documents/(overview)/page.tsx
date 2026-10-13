import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Baby, FolderOpen, Search, Users } from "lucide-react";
import { requireKg, type KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups, listStaff, isActivePerson } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { todayIn } from "@/lib/format";
import { canUploadStaffDocs, listChildDocuments, listStaffDocuments } from "@/lib/documents";
import { ChildFolder, FolderLink, StaffFolder, withGroup } from "@/components/documents/folders";
import { ExpiryBadge } from "@/components/documents/expiry-badge";

export async function generateMetadata() {
  return { title: (await getTranslations("documents"))("title") };
}

type SP = { tab?: string; q?: string; filter?: string };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireKg();
  const sp = await searchParams;
  const t = await getTranslations("documents");
  const role = ctx.role;
  const subtitle =
    role === "parent" ? t("subtitleParent") : role === "owner" || role === "head" || role === "accountant" ? t("subtitleAdmin") : t("subtitleStaff");
  return (
    <>
      <PageHeader title={t("title")} description={subtitle} />
      {role === "parent" ? (
        <ParentView ctx={ctx} />
      ) : role === "owner" || role === "head" ? (
        <AdminView ctx={ctx} sp={sp} />
      ) : role === "accountant" ? (
        <div className="space-y-4">
          <StaffOverview ctx={ctx} filter={sp.filter} base="/documents" />
          <MyDocuments ctx={ctx} />
        </div>
      ) : role === "teacher" ? (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <GroupChildren ctx={ctx} />
          <MyDocuments ctx={ctx} />
        </div>
      ) : (
        <MyDocuments ctx={ctx} />
      )}
    </>
  );
}

async function ParentView({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("documents");
  const supabase = await createClient();
  const [{ data }, groups] = await Promise.all([
    supabase.from("child_guardians").select("children(id, full_name, group_id, status)").eq("user_id", ctx.userId).eq("kindergarten_id", ctx.kg.id),
    listGroups(supabase, ctx.kg.id),
  ]);
  const kids = ((data ?? []) as unknown as { children: { id: string; full_name: string; group_id: string | null; status: string } | null }[])
    .map((r) => r.children)
    .filter((c): c is NonNullable<typeof c> => !!c && c.status === "active")
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  if (!kids.length) {
    return (
      <Card>
        <EmptyState icon={Baby} title={t("noOwnChildren")} />
      </Card>
    );
  }
  const docs = await listChildDocuments(supabase, ctx.kg.id, kids.map((k) => k.id));
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {kids.map((k) => (
        <ChildFolder
          key={k.id}
          ctx={ctx}
          child={{ id: k.id, fullName: k.full_name, groupName: groups.find((g) => g.id === k.group_id)?.name }}
          docs={docs.filter((d) => d.childId === k.id)}
          canUpload
        />
      ))}
      <p className="text-sm text-muted lg:col-span-2">{t("parentHint")}</p>
    </div>
  );
}

async function MyDocuments({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("documents");
  const supabase = await createClient();
  const [docs, canUpload] = await Promise.all([
    listStaffDocuments(supabase, ctx.kg.id, { userId: ctx.userId }),
    canUploadStaffDocs(supabase, ctx.kg.id, ctx.userId),
  ]);
  return <StaffFolder ctx={ctx} userId={ctx.userId} title={t("myDocuments")} docs={docs} canUpload={canUpload} />;
}

/** Teacher: children of own groups (view only). */
async function GroupChildren({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("documents");
  const supabase = await createClient();
  const { data: gt } = await supabase.from("group_teachers").select("group_id, groups(name)").eq("user_id", ctx.userId).eq("kindergarten_id", ctx.kg.id);
  const groupIds = (gt ?? []).map((g) => g.group_id as string);
  const gName = new Map((gt ?? []).map((g) => [g.group_id as string, (g as unknown as { groups: { name: string } | null }).groups?.name ?? ""]));
  const { data: kids } = groupIds.length
    ? await supabase.from("children").select("id, full_name, group_id").in("group_id", groupIds).eq("status", "active").order("full_name")
    : { data: [] as { id: string; full_name: string; group_id: string }[] };
  const docs = await listChildDocuments(supabase, ctx.kg.id, (kids ?? []).map((k) => k.id));
  return (
    <Card className="p-0" data-testid="group-children">
      <CardHeader title={t("groupChildren")} className="mb-0 px-5 pt-5 pb-3" />
      {kids?.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {kids.map((k) => (
            <li key={k.id}>
              <FolderLink
                href={`/documents/child/${k.id}`}
                title={k.full_name}
                subtitle={withGroup(gName.get(k.group_id), t("count", { count: docs.filter((d) => d.childId === k.id).length }))}
                testId={`child-row-${k.id}`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Baby} title={t("noGroupChildren")} className="py-8" />
      )}
    </Card>
  );
}

function TabLink({ href, active, children, testId }: { href: string; active: boolean; children: ReactNode; testId: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-10 pointer-coarse:h-11 items-center rounded-xl px-4 text-sm font-semibold", active ? "bg-surface text-text shadow-sm" : "text-muted")}
    >
      {children}
    </Link>
  );
}

async function AdminView({ ctx, sp }: { ctx: KgContext; sp: SP }) {
  const t = await getTranslations("documents");
  const staffTab = sp.tab === "staff";
  return (
    <>
      <div className="mb-4 inline-flex gap-1 rounded-2xl bg-surface-muted p-1">
        <TabLink href="/documents" active={!staffTab} testId="docs-tab-children">
          {t("tabs.children")}
        </TabLink>
        <TabLink href="/documents?tab=staff" active={staffTab} testId="docs-tab-staff">
          {t("tabs.staff")}
        </TabLink>
      </div>
      {staffTab ? <StaffOverview ctx={ctx} filter={sp.filter} base="/documents?tab=staff" /> : <ChildrenOverview ctx={ctx} q={sp.q} />}
    </>
  );
}

async function ChildrenOverview({ ctx, q }: { ctx: KgContext; q?: string }) {
  const t = await getTranslations("documents");
  const supabase = await createClient();
  const query = (q ?? "").trim().slice(0, 100);
  let req = supabase.from("children").select("id, full_name, group_id").eq("kindergarten_id", ctx.kg.id).eq("status", "active").order("full_name");
  if (query) req = req.ilike("full_name", `%${query.replace(/[%_\\]/g, "\\$&")}%`);
  const [{ data: kids }, groups, docs] = await Promise.all([req, listGroups(supabase, ctx.kg.id), listChildDocuments(supabase, ctx.kg.id)]);
  const count = (id: string) => docs.filter((d) => d.childId === id).length;
  return (
    <Card className="p-0">
      <form action="/documents" className="flex gap-2 p-4 md:p-5" role="search" aria-label={t("search")}>
        <label htmlFor="doc-search" className="sr-only">
          {t("search")}
        </label>
        <Input id="doc-search" name="q" defaultValue={query} placeholder={t("searchPlaceholder")} data-testid="doc-search" />
        <Button type="submit" variant="outline" size="icon" className="shrink-0" aria-label={t("search")}>
          <Search />
        </Button>
      </form>
      {kids?.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {kids.map((k) => {
            const n = count(k.id);
            return (
              <li key={k.id}>
                <FolderLink
                  href={`/documents/child/${k.id}`}
                  title={k.full_name}
                  subtitle={withGroup(groups.find((g) => g.id === k.group_id)?.name, t("noGroup"), true)}
                  right={<Badge tone={n ? "sky" : "neutral"}>{t("count", { count: n })}</Badge>}
                  testId={`child-row-${k.id}`}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Search} title={t("noChildren")} className="border-t border-border" />
      )}
    </Card>
  );
}

/** Owner/head/accountant: all employees with document counts and the most urgent expiry; filter «истекают». */
async function StaffOverview({ ctx, filter, base }: { ctx: KgContext; filter?: string; base: string }) {
  const t = await getTranslations("documents");
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const expiring = filter === "expiring";
  const sep = base.includes("?") ? "&" : "?";
  const [people, docs, soon] = await Promise.all([
    listStaff(supabase, ctx.kg.id),
    listStaffDocuments(supabase, ctx.kg.id),
    listStaffDocuments(supabase, ctx.kg.id, { expiringFrom: today }),
  ]);
  const active = people.filter(isActivePerson);
  return (
    <Card className="p-0" data-testid="staff-documents">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
        <h2 className="text-[15px] font-bold">{t("staffList")}</h2>
        <div className="inline-flex gap-1 rounded-2xl bg-surface-muted p-1">
          <TabLink href={base} active={!expiring} testId="docs-filter-all">
            {t("filterAll")}
          </TabLink>
          <TabLink href={`${base}${sep}filter=expiring`} active={expiring} testId="docs-filter-expiring">
            {t("filterExpiring")}
            {soon.length ? <span className="ml-1.5 text-faint">{soon.length}</span> : null}
          </TabLink>
        </div>
      </div>
      {expiring ? (
        soon.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {soon.map((d) => (
              <li key={d.id}>
                <FolderLink
                  href={`/documents/staff/${d.userId}`}
                  title={d.personName}
                  subtitle={<span data-user-content>{d.title}</span>}
                  right={<ExpiryBadge expiresOn={d.expiresOn} today={today} />}
                  testId={`expiring-row-${d.id}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FolderOpen} title={t("noExpiring")} className="border-t border-border" />
        )
      ) : active.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {active.map((p) => {
            const mine = docs.filter((d) => d.userId === p.userId);
            const urgent = soon.find((d) => d.userId === p.userId);
            return (
              <li key={p.userId}>
                <FolderLink
                  href={`/documents/staff/${p.userId}`}
                  title={p.fullName}
                  subtitle={t("count", { count: mine.length })}
                  right={urgent ? <ExpiryBadge expiresOn={urgent.expiresOn} today={today} /> : null}
                  testId={`staff-row-${p.phone}`}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Users} title={t("noStaff")} className="border-t border-border" />
      )}
    </Card>
  );
}

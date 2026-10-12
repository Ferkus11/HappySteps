import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Baby, Search } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ageOn, todayIn } from "@/lib/format";
import { signedUrls } from "@/lib/kg-assets";
import { AddChildButton } from "./add-child";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("children"))("title") };
}

export default async function ChildrenPage({ searchParams }: { searchParams: Promise<{ q?: string; group?: string; status?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher"]);
  const sp = await searchParams;
  const status = sp.status === "archived" ? "archived" : "active";
  const t = await getTranslations("children");
  const supabase = await createClient();
  const groups = await listGroups(supabase, ctx.kg.id);
  let query = supabase
    .from("children")
    .select("id, full_name, birth_date, group_id, allergies, photo_path, archive_reason")
    .eq("kindergarten_id", ctx.kg.id)
    .eq("status", status)
    .order("full_name");
  if (sp.group) query = query.eq("group_id", sp.group);
  if (ctx.role === "teacher") {
    // In the teacher context show only the teacher's groups (RLS may also allow own children as a parent).
    const { data: mine } = await supabase.from("group_teachers").select("group_id").eq("user_id", ctx.userId).eq("kindergarten_id", ctx.kg.id);
    query = query.in("group_id", (mine ?? []).map((m) => m.group_id));
  }
  if (sp.q) query = query.ilike("full_name", `%${sp.q.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const children = data ?? [];
  const photos = await signedUrls("child-photos", children.map((c) => c.photo_path).filter(Boolean) as string[]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const today = todayIn(ctx.settings.timezone);
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const visibleGroups = ctx.role === "teacher" ? groups.filter((g) => children.some((c) => c.group_id === g.id)) : groups;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, group: sp.group, status: sp.status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/children?${s}` : "/children";
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={isAdmin ? <AddChildButton groups={groups.map((g) => ({ id: g.id, name: g.name }))} today={today} /> : null}
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <form className="relative md:w-72" action="/children">
          {sp.group ? <input type="hidden" name="group" value={sp.group} /> : null}
          {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            name="q"
            defaultValue={sp.q}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-11 w-full rounded-xl border border-border bg-surface pr-3 pl-10 text-sm focus:border-brand focus:outline-none"
          />
        </form>
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          <Link href={qs({ group: undefined })} className={cn("flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold", !sp.group ? "bg-text text-white" : "bg-surface text-muted border border-border")}>
            {t("allGroups")}
          </Link>
          {visibleGroups.map((g) => (
            <Link
              key={g.id}
              href={qs({ group: g.id })}
              className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold", sp.group === g.id ? "bg-text text-white" : "border border-border bg-surface text-muted")}
            >
              <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              {g.name}
            </Link>
          ))}
        </div>
        {ctx.role !== "teacher" ? (
          <div className="flex gap-1 md:ml-auto">
            <Link href={qs({ status: undefined })} className={cn("flex h-10 items-center rounded-xl px-3 text-sm font-semibold", status === "active" ? "bg-surface shadow-sm" : "text-muted")}>
              {t("statusActive")}
            </Link>
            <Link href={qs({ status: "archived" })} className={cn("flex h-10 items-center rounded-xl px-3 text-sm font-semibold", status === "archived" ? "bg-surface shadow-sm" : "text-muted")}>
              {t("statusArchived")}
            </Link>
          </div>
        ) : null}
      </div>
      {children.length === 0 ? (
        <Card>
          <EmptyState icon={Baby} title={sp.q || sp.group ? t("emptyFiltered") : t("empty")} hint={!sp.q && isAdmin ? t("emptyHint") : undefined} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {children.map((c) => {
              const g = c.group_id ? groupById.get(c.group_id) : null;
              return (
                <li key={c.id}>
                  <Link href={`/children/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5" data-testid="child-row">
                    <Avatar name={c.full_name} src={c.photo_path ? photos[c.photo_path] : null} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{c.full_name}</div>
                      <div className="truncate text-sm text-muted">
                        {t("age", { count: ageOn(c.birth_date, today) })}
                        {g ? ` · ${g.name}` : ""}
                      </div>
                    </div>
                    {c.allergies ? <Badge tone="warning" className="hidden sm:inline-flex">{t("allergies")}</Badge> : null}
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

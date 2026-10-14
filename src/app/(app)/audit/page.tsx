import { getTranslations } from "next-intl/server";
import { History } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listStaff } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { auditRefs, describeAudit, type AuditNames, type AuditTranslator } from "@/lib/audit-details";

export async function generateMetadata() {
  return { title: (await getTranslations("audit"))("title") };
}

const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; from?: string; to?: string }> }) {
  const ctx = await requireKg(["owner", "head"]);
  const sp = await searchParams;
  const t = await getTranslations("audit");
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, details, created_at, actor_id")
    .eq("kindergarten_id", ctx.kg.id)
    .order("created_at", { ascending: false })
    .limit(PAGE);
  if (sp.action) q = q.like("action", `${sp.action.replace(/[%_]/g, "")}%`);
  if (sp.actor) q = q.eq("actor_id", sp.actor);
  if (sp.from) q = q.gte("created_at", `${sp.from}T00:00:00+05:00`);
  if (sp.to) q = q.lte("created_at", `${sp.to}T23:59:59+05:00`);
  const [{ data: rows }, staff] = await Promise.all([q, listStaff(supabase, ctx.kg.id)]);
  const names = new Map(staff.map((p) => [p.userId, p.fullName]));
  const sections = t.raw("sections") as Record<string, string>;
  const prefixes = Object.keys(sections);
  // Keys contain dots ("worktime.edit"), which next-intl would read as a path — look them up in the raw map.
  const labels = t.raw("actions") as Record<string, string>;
  const actionLabel = (a: string) => labels[a] ?? a;
  const tz = ctx.settings.timezone;
  const auditNames = await loadAuditNames(supabase, ctx.kg.id, rows ?? [], names);
  const tAll = (await getTranslations()) as unknown as AuditTranslator;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_160px_160px_auto]" action="/audit">
          <Select name="action" defaultValue={sp.action ?? ""} aria-label={t("action")}>
            <option value="">{t("allActions")}</option>
            {prefixes.map((p) => (
              <option key={p} value={p}>
                {sections[p]}
              </option>
            ))}
          </Select>
          <Select name="actor" defaultValue={sp.actor ?? ""} aria-label={t("actor")}>
            <option value="">{t("allActors")}</option>
            {staff.map((p) => (
              <option data-user-content key={p.userId} value={p.userId}>
                {p.fullName}
              </option>
            ))}
          </Select>
          <Input type="date" name="from" defaultValue={sp.from} aria-label={t("fromDate")} />
          <Input type="date" name="to" defaultValue={sp.to} aria-label={t("toDate")} />
          <Button type="submit" variant="secondary">
            {t("filter")}
          </Button>
        </form>
      </Card>
      {!rows?.length ? (
        <Card>
          <EmptyState icon={History} title={t("empty")} hint={t("emptyHint")} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-1 px-4 py-3 md:grid-cols-[170px_1fr_220px] md:items-center md:gap-4 md:px-5" data-testid="audit-row">
                <span className="text-sm text-muted">{formatDateTime(r.created_at, tz)}</span>
                <span className="min-w-0">
                  <span className="font-semibold">{actionLabel(r.action)}</span>
                  <AuditDetail text={describeAudit(r, tAll, auditNames, tz)} />
                </span>
                <span className="truncate text-sm" data-user-content={r.actor_id ? "" : undefined}>{r.actor_id ? (names.get(r.actor_id) ?? "—") : t("system")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function AuditDetail({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="mt-0.5 line-clamp-2 block text-xs text-muted" data-user-content data-testid="audit-detail">
      {text}
    </span>
  );
}

/**
 * Names for the ids the rows refer to (people, children, groups). One query each over the garden — no
 * `in (…)` with up to 200 ids in the URL; a garden has a few hundred people at most. RLS applies.
 */
async function loadAuditNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kgId: string,
  rows: Parameters<typeof auditRefs>[0],
  staff: Map<string, string>,
): Promise<AuditNames> {
  const ids = auditRefs(rows);
  const people = new Map(staff);
  const children = new Map<string, string>();
  const groups = new Map<string, string>();
  if (!ids.length) return { people, children, groups };
  const [{ data: kids }, { data: gs }, { data: members }] = await Promise.all([
    supabase.from("children").select("id, full_name").eq("kindergarten_id", kgId),
    supabase.from("groups").select("id, name").eq("kindergarten_id", kgId),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("kindergarten_id", kgId).eq("role", "parent"),
  ]);
  for (const k of kids ?? []) children.set(k.id as string, k.full_name as string);
  for (const g of gs ?? []) groups.set(g.id as string, g.name as string);
  for (const m of (members ?? []) as unknown as { user_id: string; profiles: { full_name: string } | null }[]) {
    if (m.profiles) people.set(m.user_id, m.profiles.full_name);
  }
  return { people, children, groups };
}

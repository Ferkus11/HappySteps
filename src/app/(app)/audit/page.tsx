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
  const prefixes = ["account", "child", "guardian", "group", "worktime", "attendance", "receipt", "invoice", "chat", "kindergarten"];
  // Keys contain dots ("worktime.edit"), which next-intl would read as a path — look them up in the raw map.
  const labels = t.raw("actions") as Record<string, string>;
  const actionLabel = (a: string) => labels[a] ?? a;
  const tz = ctx.settings.timezone;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_160px_160px_auto]" action="/audit">
          <Select name="action" defaultValue={sp.action ?? ""} aria-label={t("action")}>
            <option value="">{t("allActions")}</option>
            {prefixes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select name="actor" defaultValue={sp.actor ?? ""} aria-label={t("actor")}>
            <option value="">{t("allActors")}</option>
            {staff.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullName}
              </option>
            ))}
          </Select>
          <Input type="date" name="from" defaultValue={sp.from} aria-label="from" />
          <Input type="date" name="to" defaultValue={sp.to} aria-label="to" />
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
                  {r.details && Object.keys(r.details).length ? (
                    <span className="block truncate text-xs text-faint">{summarize(r.details as Record<string, unknown>, names)}</span>
                  ) : null}
                </span>
                <span className="truncate text-sm">{r.actor_id ? (names.get(r.actor_id) ?? "—") : t("system")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function summarize(d: Record<string, unknown>, names: Map<string, string>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === "string" && names.has(v) ? names.get(v) : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

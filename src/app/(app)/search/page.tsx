import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhone } from "@/lib/phone";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireKg();
  const { q = "" } = await searchParams;
  const t = await getTranslations("profile");
  const tn = await getTranslations("nav");
  const term = q.trim().replace(/[%_,()]/g, "");
  const supabase = await createClient();
  const canSeeStaff = ["owner", "head", "accountant"].includes(ctx.role);
  const [children, staff] = term.length >= 2
    ? await Promise.all([
        supabase.from("children").select("id, full_name").eq("kindergarten_id", ctx.kg.id).eq("status", "active").ilike("full_name", `%${term}%`).limit(20),
        canSeeStaff
          ? supabase
              .from("memberships")
              .select("user_id, profiles!inner(full_name, phone)")
              .eq("kindergarten_id", ctx.kg.id)
              .neq("role", "parent")
              .eq("status", "active")
              .ilike("profiles.full_name", `%${term}%`)
              .limit(20)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }];
  const staffRows = [...new Map(((staff.data ?? []) as unknown as { user_id: string; profiles: { full_name: string; phone: string } }[]).map((r) => [r.user_id, r])).values()];
  const none = !children.data?.length && !staffRows.length;
  return (
    <>
      <PageHeader title={t("searchTitle")} description={term ? `«${q}»` : t("searchHint")} />
      {none ? (
        <Card>
          <EmptyState icon={Search} title={term ? t("searchEmpty") : t("searchHint")} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {children.data?.length ? (
            <Card>
              <CardHeader title={tn("children")} />
              <ul className="space-y-1">
                {children.data.map((c) => (
                  <li key={c.id}>
                    <Link href={`/children/${c.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-muted">
                      <Avatar name={c.full_name} size={32} /> {c.full_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {staffRows.length ? (
            <Card>
              <CardHeader title={tn("staff")} />
              <ul className="space-y-1">
                {staffRows.map((s) => (
                  <li key={s.user_id}>
                    <Link href={`/staff/${s.user_id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-muted">
                      <Avatar name={s.profiles.full_name} size={32} />
                      <span className="flex-1">{s.profiles.full_name}</span>
                      <span className="text-sm text-muted">{formatPhone(s.profiles.phone)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}

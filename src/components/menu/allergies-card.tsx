import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

type Row = { child_id: string; full_name: string; group_id: string | null; group_name: string | null; allergies: string };

/** Kitchen allergy list (SPEC §5.4): full name, group, allergy — via kitchen_allergies(), no other child data. */
export async function AllergiesCard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("menu.allergies");
  const supabase = await createClient();
  const { data } = await supabase.rpc("kitchen_allergies", { kg: ctx.kg.id });
  const rows = (data ?? []) as Row[];
  return (
    <Card data-testid="allergies-list">
      <CardHeader
        title={t("title")}
        action={rows.length ? <Badge tone="warning">{t("count", { count: rows.length })}</Badge> : null}
      />
      {rows.length === 0 ? (
        <EmptyState className="py-6" icon={ShieldCheck} title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.child_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0" data-testid="allergy-row">
              <div className="min-w-0 flex-1">
                <div data-user-content className="font-semibold break-words">{r.full_name}</div>
                <div data-user-content className="text-[13px] text-muted">{r.group_name ?? t("noGroup")}</div>
              </div>
              <span data-user-content className="max-w-full rounded-full bg-tile-late px-2.5 py-1 text-[13px] font-semibold break-words text-tile-late-fg">{r.allergies}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

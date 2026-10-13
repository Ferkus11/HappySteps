import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { WAITING } from "@/lib/waitlist";
import type { WaitlistStatus } from "@/lib/waitlist";
import { WaitlistStatusBadge } from "./status-badge";

/** «Лист ожидания» on the owner/head dashboard: N children waiting + the latest applications (SPEC §6). */
async function WaitlistWidget({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("waitlist");
  const supabase = await createClient();
  const [{ count }, { data }] = await Promise.all([
    supabase.from("waitlist_applications").select("id", { count: "exact", head: true }).eq("kindergarten_id", ctx.kg.id).in("status", WAITING),
    supabase
      .from("waitlist_applications")
      .select("id, child_name, status, created_at")
      .eq("kindergarten_id", ctx.kg.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const waiting = count ?? 0;
  const latest = (data ?? []) as { id: string; child_name: string; status: WaitlistStatus; created_at: string }[];
  return (
    <Card data-testid="waitlist-widget">
      <CardHeader title={t("title")} href="/waitlist" />
      <Link href="/waitlist" className="block rounded-2xl bg-sky-soft p-4 hover:bg-sky/15">
        <span className="text-[30px] leading-none font-extrabold tracking-tight text-text" data-testid="waitlist-waiting">
          {waiting}
        </span>
        <span className="ml-2 text-[13px] font-semibold text-sky-strong">{t("widgetWaiting", { count: waiting })}</span>
      </Link>
      {latest.length ? (
        <>
          <p className="mt-4 mb-1 text-xs font-semibold text-faint uppercase">{t("widgetLatest")}</p>
          <ul className="-mx-2">
            {latest.map((a) => (
              <li key={a.id}>
                <Link href={`/waitlist/${a.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-muted" data-testid="waitlist-widget-row">
                  <span className="min-w-0 flex-1">
                    <span data-user-content className="block truncate text-sm font-semibold">{a.child_name}</span>
                    <span className="block text-xs text-faint">{formatDate(a.created_at, ctx.settings.timezone)}</span>
                  </span>
                  <WaitlistStatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("widgetEmpty")}</p>
      )}
    </Card>
  );
}

export const waitlistWidgets: DashboardWidget[] = [
  { id: "waitlist", roles: ["owner", "head"], slot: "side", order: 20, phoneOrder: 50, Component: WaitlistWidget },
];

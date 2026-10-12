import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Baby } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ageOn, todayIn } from "@/lib/format";
import { signedUrls } from "@/lib/kg-assets";
import { Greeting } from "./greeting";

export async function myChildren(ctx: KgContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("child_guardians")
    .select("children!inner(id, full_name, birth_date, photo_path, status, group_id, groups(name, color))")
    .eq("user_id", ctx.userId)
    .eq("kindergarten_id", ctx.kg.id)
    .eq("children.status", "active");
  return ((data ?? []) as unknown as {
    children: { id: string; full_name: string; birth_date: string; photo_path: string | null; group_id: string | null; groups: { name: string; color: string } | null };
  }[]).map((r) => r.children);
}

export async function ParentDashboard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("children");
  const kids = await myChildren(ctx);
  const photos = await signedUrls("child-photos", kids.map((k) => k.photo_path ?? "").filter(Boolean));
  const today = todayIn(ctx.settings.timezone);
  return (
    <>
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <Card>
        <CardHeader title={t("myChildren")} />
        {kids.length === 0 ? (
          <EmptyState icon={Baby} title={t("noChildren")} hint={t("noChildrenHint")} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {kids.map((k) => (
              <li key={k.id}>
                <Link href={`/children/${k.id}`} className="flex items-center gap-3 rounded-2xl bg-surface-muted p-3" data-testid="my-child">
                  <Avatar name={k.full_name} src={k.photo_path ? photos[k.photo_path] : null} size={52} />
                  <div className="min-w-0">
                    <div className="truncate font-bold">{k.full_name}</div>
                    <div className="truncate text-sm text-muted">
                      {tc("age", { count: ageOn(k.birth_date, today) })}
                      {k.groups ? ` · ${k.groups.name}` : ""}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

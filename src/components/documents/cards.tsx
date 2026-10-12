import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { todayIn } from "@/lib/format";
import { CHILD_CATEGORIES } from "@/lib/documents-logic";
import { canViewChildDocs, listChildDocuments, listStaffDocuments } from "@/lib/documents";
import { ExpiryBadge } from "./expiry-badge";

/** «Документы» on the child card: count per category + link to the folder. Hidden for roles without access. */
export async function ChildDocumentsCard({ ctx, childId }: { ctx: KgContext; childId: string }) {
  const supabase = await createClient();
  if (!(await canViewChildDocs(supabase, childId))) return null;
  const t = await getTranslations("documents");
  const docs = await listChildDocuments(supabase, ctx.kg.id, [childId]);
  return (
    <Card data-testid="child-documents-card">
      <CardHeader title={t("cardTitle")} href={`/documents/child/${childId}`} />
      <ul className="grid grid-cols-2 gap-2">
        {CHILD_CATEGORIES.map((c) => {
          const n = docs.filter((d) => d.category === c).length;
          return (
            <li key={c}>
              <Link
                href={`/documents/child/${childId}?category=${c}`}
                className="flex min-h-16 flex-col justify-center rounded-2xl bg-surface-muted px-3 py-2 hover:bg-sky-soft"
                data-testid={`child-doc-count-${c}`}
              >
                <span className="text-xl font-extrabold leading-tight text-text">{n}</span>
                <span className="text-xs text-muted">{t(`categories.${c}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** «Документы» on the employee card (owner/head/accountant): the list with expiry badges + link to the folder. */
export async function StaffDocumentsCard({ ctx, userId }: { ctx: KgContext; userId: string }) {
  const supabase = await createClient();
  const docs = await listStaffDocuments(supabase, ctx.kg.id, { userId });
  const t = await getTranslations("documents");
  const today = todayIn(ctx.settings.timezone);
  return (
    <Card data-testid="staff-documents-card">
      <CardHeader title={t("cardTitle")} href={`/documents/staff/${userId}`} />
      {docs.length ? (
        <ul className="space-y-2.5 text-sm">
          {docs.slice(0, 6).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 truncate font-semibold">{d.title}</span>
              <ExpiryBadge expiresOn={d.expiresOn} today={today} />
            </li>
          ))}
          {docs.length > 6 ? <li className="text-muted">{t("andMore", { count: docs.length - 6 })}</li> : null}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("empty")}</p>
      )}
    </Card>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FolderOpen } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { todayIn } from "@/lib/format";
import { CHILD_CATEGORIES, type ChildCategory } from "@/lib/documents-logic";
import type { ChildDoc, StaffDoc } from "@/lib/documents";
import { DocumentList } from "./document-list";
import { UploadDocumentButton } from "./upload-dialog";
import { ChildFolderView } from "./child-folder-view";

export function isAdminCtx(ctx: KgContext) {
  return ctx.roles.includes("owner") || ctx.roles.includes("head");
}

/** A child's folder: four category tabs, «Загрузить» for parents and owner/head, view only for the teacher. */
export async function ChildFolder({
  ctx,
  child,
  docs,
  canUpload,
  initialCategory,
  titleHref,
}: {
  ctx: KgContext;
  child: { id: string; fullName: string; groupName?: string | null };
  docs: ChildDoc[];
  canUpload: boolean;
  initialCategory?: string;
  titleHref?: string;
}) {
  const t = await getTranslations("documents");
  const admin = isAdminCtx(ctx);
  const today = todayIn(ctx.settings.timezone);
  const by = (c: ChildCategory) => docs.filter((d) => d.category === c);
  const first =
    CHILD_CATEGORIES.find((c) => c === initialCategory) ?? CHILD_CATEGORIES.find((c) => by(c).length > 0) ?? CHILD_CATEGORIES[0];
  return (
    <Card className="min-w-0" data-testid={`child-folder-${child.id}`}>
      <ChildFolderView
        child={{ id: child.id, fullName: child.fullName }}
        subtitle={[child.groupName, t("count", { count: docs.length })].filter(Boolean).join(" · ")}
        titleHref={titleHref}
        canUpload={canUpload}
        first={first}
        today={today}
        timezone={ctx.settings.timezone}
        docs={docs.map((d) => ({
          id: d.id,
          category: d.category,
          title: d.title,
          mime: d.mime,
          size: d.size,
          createdAt: d.createdAt,
          meta: d.uploaderName,
          canDelete: admin || (canUpload && d.uploadedBy === ctx.userId),
        }))}
      />
    </Card>
  );
}

/** One employee's documents (own «Мои документы» or a person's folder for owner/head/accountant). */
export async function StaffFolder({
  ctx,
  userId,
  title,
  docs,
  canUpload,
}: {
  ctx: KgContext;
  userId: string;
  title: string;
  docs: StaffDoc[];
  canUpload: boolean;
}) {
  const t = await getTranslations("documents");
  const admin = isAdminCtx(ctx);
  const today = todayIn(ctx.settings.timezone);
  const own = userId === ctx.userId;
  return (
    <Card className="min-w-0" data-testid={own ? "my-documents" : `staff-folder-${userId}`}>
      <CardHeader
        title={title}
        action={
          canUpload ? (
            <UploadDocumentButton kind="staff" userId={userId} who={own ? undefined : title} size="sm" />
          ) : (
            <Badge tone="neutral" data-testid="doc-view-only">{t("viewOnly")}</Badge>
          )
        }
      />
      {docs.length ? (
        <DocumentList
          kind="staff"
          today={today}
          timezone={ctx.settings.timezone}
          items={docs.map((d) => ({
            id: d.id,
            title: d.title,
            mime: d.mime,
            size: d.size,
            createdAt: d.createdAt,
            label: d.title === t(`types.${d.type}`) ? null : t(`types.${d.type}`),
            expiresOn: d.expiresOn,
            canDelete: admin || (own && canUpload && d.uploadedBy === ctx.userId),
          }))}
        />
      ) : (
        <EmptyState icon={FolderOpen} title={t("empty")} hint={canUpload ? t("emptyStaffHint") : undefined} className="py-6" />
      )}
    </Card>
  );
}

/** Link row used in lists of children / staff. */
export function FolderLink({ href, title, subtitle, right, testId }: { href: string; title: string; subtitle?: string; right?: ReactNode; testId?: string }) {
  return (
    <Link href={href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5" data-testid={testId}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky-strong">
        <FolderOpen className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        {subtitle ? <span className="block truncate text-sm text-muted">{subtitle}</span> : null}
        {/* phones: the badge goes under the name so long names stay readable */}
        {right ? <span className="mt-1 block sm:hidden">{right}</span> : null}
      </span>
      {right ? <span className="hidden shrink-0 sm:block">{right}</span> : null}
    </Link>
  );
}

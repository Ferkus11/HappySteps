"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHILD_CATEGORIES, type ChildCategory } from "@/lib/documents-logic";
import { DocumentList, type DocItem } from "./document-list";
import { UploadDocumentButton } from "./upload-dialog";

/** Category tabs of a child's folder; «Загрузить» defaults to the open tab. */
export function ChildFolderView({
  child,
  subtitle,
  titleHref,
  canUpload,
  first,
  docs,
  today,
  timezone,
}: {
  child: { id: string; fullName: string };
  subtitle: React.ReactNode;
  titleHref?: string;
  canUpload: boolean;
  first: ChildCategory;
  docs: (DocItem & { category: ChildCategory })[];
  today: string;
  timezone: string;
}) {
  const t = useTranslations("documents");
  const [tab, setTab] = React.useState<ChildCategory>(first);
  const by = (c: ChildCategory) => docs.filter((d) => d.category === c);
  return (
    <>
      <CardHeader
        title={
          <span className="flex flex-col">
            <span data-user-content>{child.fullName}</span>
            <span className="text-[13px] font-medium text-muted">{subtitle}</span>
          </span>
        }
        href={titleHref}
        action={
          canUpload ? (
            <UploadDocumentButton key={tab} kind="child" childId={child.id} defaultCategory={tab} who={child.fullName} size="sm" />
          ) : (
            <Badge tone="neutral" data-testid="doc-view-only">
              {t("viewOnly")}
            </Badge>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as ChildCategory)}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          {CHILD_CATEGORIES.map((c) => (
            <TabsTrigger key={c} value={c} data-testid={`doc-tab-${c}`} className="px-3">
              {t(`categoriesShort.${c}`)}
              {by(c).length ? <span className="ml-1.5 text-faint">{by(c).length}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {CHILD_CATEGORIES.map((c) => (
          <TabsContent key={c} value={c} data-testid={`doc-panel-${c}`}>
            <h3 className="sr-only">{t(`categories.${c}`)}</h3>
            {by(c).length ? (
              <DocumentList kind="child" today={today} timezone={timezone} items={by(c)} />
            ) : (
              <p className="rounded-2xl bg-surface-muted px-4 py-6 text-center text-sm text-muted">
                {t("emptyCategory", { category: t(`categories.${c}`) })}
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink, FileText, ImageIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { isImageMime } from "@/lib/documents-logic";
import { formatDate } from "@/lib/format";
import { deleteChildDocumentAction, deleteStaffDocumentAction } from "@/app/(app)/documents/actions";
import { ExpiryBadge } from "./expiry-badge";

export interface DocItem {
  id: string;
  title: string;
  mime: string;
  size: number;
  createdAt: string;
  /** Second line: uploader, person or type. */
  meta?: string | null;
  label?: string | null;
  expiresOn?: string | null;
  canDelete: boolean;
}

function fileUrl(kind: "child" | "staff", id: string) {
  return `/documents/file/${id}${kind === "staff" ? "?k=s" : ""}`;
}


/**
 * Documents as rows. Photos open in a dialog, PDFs in a new tab — both through /documents/file/<id>,
 * which checks access with RLS and redirects to a one-minute signed URL.
 */
export function DocumentList({ kind, items, today, timezone }: { kind: "child" | "staff"; items: DocItem[]; today: string; timezone: string }) {
  const t = useTranslations("documents");
  const fmt = useFormatter();
  const sizeLabel = (bytes: number) =>
    bytes >= 1024 * 1024
      ? fmt.number(bytes / 1024 / 1024, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 })
      : fmt.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte", unitDisplay: "short" });
  const [photo, setPhoto] = React.useState<DocItem | null>(null);
  const del = useAction(kind === "child" ? deleteChildDocumentAction : deleteStaffDocumentAction, { success: t("deleted") });
  return (
    <>
      <ul className="divide-y divide-border" data-testid="doc-list">
        {items.map((d) => {
          const image = isImageMime(d.mime);
          const Icon = image ? ImageIcon : FileText;
          const body = (
            <>
              <span className={image ? "grid size-11 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky-strong" : "grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-text">{d.title}</span>
                <span className="block truncate text-[13px] text-muted">
                  {[d.label, formatDate(d.createdAt, timezone), sizeLabel(d.size), d.meta].filter(Boolean).join(" · ")}
                </span>
                {d.expiresOn ? (
                  <span className="mt-1 block">
                    <ExpiryBadge expiresOn={d.expiresOn} today={today} />
                  </span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={d.id} className="flex items-center gap-2 py-2.5" data-testid="doc-row" data-doc-id={d.id}>
              {image ? (
                <button
                  type="button"
                  onClick={() => setPhoto(d)}
                  className="flex min-h-12 min-w-0 flex-1 cursor-zoom-in items-center gap-3 rounded-xl text-left"
                  data-testid="doc-open"
                >
                  {body}
                </button>
              ) : (
                <a
                  href={fileUrl(kind, d.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl"
                  data-testid="doc-open"
                >
                  {body}
                  <ExternalLink className="size-4 shrink-0 text-faint" aria-label={t("openNewTab")} />
                </a>
              )}
              {d.canDelete ? (
                <Confirm
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={t("delete")} data-testid="doc-delete" disabled={del.pending}>
                      <Trash2 className="text-muted" />
                    </Button>
                  }
                  title={t("deleteTitle")}
                  description={t("deleteText", { title: d.title })}
                  confirmLabel={t("delete")}
                  danger
                  onConfirm={() => del.run(d.id)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!photo} onOpenChange={(v) => !v && setPhoto(null)}>
        {photo ? (
          <DialogContent title={photo.title} className="md:w-[min(92vw,960px)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(kind, photo.id)} alt={photo.title} className="mx-auto max-h-[70dvh] w-auto rounded-xl object-contain" data-testid="doc-lightbox-img" />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

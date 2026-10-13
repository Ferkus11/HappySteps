"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, ImagePlus, Paperclip, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/actions/result";
import {
  createAnnouncementAction,
  removeAnnouncementFileAction,
  updateAnnouncementAction,
  uploadAnnouncementFileAction,
} from "@/app/(app)/announcements/actions";
import { AudienceFields, readAudience, type Audience, type TargetGroup } from "./audience-fields";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

const MAX_FILE = 15 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PER_KIND = 10;

export interface AnnouncementFormValue {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  groupIds: string[];
  important: boolean;
  files: { id: string; kind: "photo" | "pdf"; name: string }[];
}

export function AnnouncementDialog({
  audiences,
  groups,
  announcement,
}: {
  audiences: Audience[];
  groups: TargetGroup[];
  announcement?: AnnouncementFormValue;
}) {
  const t = useTranslations("announcements");
  const te = useTranslations("errors");
  const offline = useOfflineGuard();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [important, setImportant] = React.useState(announcement?.important ?? false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const photoInput = React.useRef<HTMLInputElement>(null);
  const pdfInput = React.useRef<HTMLInputElement>(null);

  const existing = (announcement?.files ?? []).filter((f) => !removed.includes(f.id));
  const count = (kind: "photo" | "pdf") =>
    existing.filter((f) => f.kind === kind).length + files.filter((f) => (kind === "pdf" ? f.type === "application/pdf" : f.type !== "application/pdf")).length;

  const errText = (code: string) => (te.has(code) ? te(code) : te("generic"));
  const failed = (r: ActionResult<unknown> | null | undefined) => {
    if (!r) return true;
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      toast.error(errText(r.error));
      return true;
    }
    return false;
  };

  function addFiles(list: FileList | null, kind: "photo" | "pdf") {
    if (!list) return;
    const next: File[] = [];
    for (const f of Array.from(list)) {
      const okType = kind === "pdf" ? f.type === "application/pdf" : PHOTO_TYPES.includes(f.type);
      if (!okType) {
        toast.error(te("fileType"));
        continue;
      }
      if (f.size > MAX_FILE) {
        toast.error(te("fileTooLarge"));
        continue;
      }
      next.push(f);
    }
    const room = MAX_PER_KIND - count(kind);
    if (next.length > room) toast.error(t("tooManyFiles", { max: MAX_PER_KIND }));
    setFiles((s) => [...s, ...next.slice(0, Math.max(0, room))]);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (offline.blocked()) return;
    const f = new FormData(e.currentTarget);
    const { audience, groupIds } = readAudience(f);
    if (audience === "groups" && !groupIds.length) {
      setErrors({ groupIds: "chooseGroups" });
      return;
    }
    const input = { title: String(f.get("title") ?? ""), body: String(f.get("body") ?? ""), audience, groupIds, important };
    setBusy(true);
    try {
      const res = announcement ? await updateAnnouncementAction(announcement.id, input) : await createAnnouncementAction(input);
      if (failed(res) || !res.ok) return;
      const id = res.data.id;
      for (const fileId of removed) failed(await removeAnnouncementFileAction(fileId));
      for (const file of files) {
        const fd = new FormData();
        fd.set("file", file);
        failed(await uploadAnnouncementFileAction(id, fd));
      }
      toast.success(announcement ? t("saved") : t("published"));
      setOpen(false);
      setFiles([]);
      setRemoved([]);
      if (announcement) router.refresh();
      else router.push(`/announcements/${id}`);
    } catch (err) {
      if (offline.failed(err)) return;
      console.error(err);
      toast.error(te("generic"));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (k: string) => (errors[k] ? (k === "groupIds" ? t("chooseGroups") : errText(errors[k])) : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setErrors({});
      }}
    >
      <DialogTrigger asChild>
        {announcement ? (
          <Button variant="outline" data-testid="edit-announcement">
            <Pencil /> {t("edit")}
          </Button>
        ) : (
          <Button data-testid="new-announcement">
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={announcement ? t("edit") : t("new")}>
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t("titleField")} htmlFor="a-title" error={fieldError("title")}>
            <Input id="a-title" name="title" defaultValue={announcement?.title} required maxLength={200} data-testid="announcement-title" />
          </Field>
          <Field label={t("bodyField")} htmlFor="a-body" error={fieldError("body")}>
            <Textarea id="a-body" name="body" defaultValue={announcement?.body} rows={5} maxLength={10000} data-testid="announcement-body" />
          </Field>
          <AudienceFields
            audiences={audiences}
            groups={groups}
            defaultAudience={announcement?.audience}
            defaultGroups={announcement?.groupIds}
            error={fieldError("groupIds")}
          />
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
            <span>
              <span className="block text-sm font-semibold">{t("important")}</span>
              <span className="block text-[13px] text-faint">{t("importantHint")}</span>
            </span>
            <Switch checked={important} onCheckedChange={setImportant} data-testid="announcement-important" aria-label={t("important")} />
          </label>
          <div>
            <div className="mb-2 text-[13px] font-semibold text-muted">{t("attachments")}</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => photoInput.current?.click()}>
                <ImagePlus /> {t("addPhotos")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => pdfInput.current?.click()}>
                <Paperclip /> {t("addPdf")}
              </Button>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept={PHOTO_TYPES.join(",")}
              multiple
              className="sr-only"
              aria-label={t("addPhotos")}
              tabIndex={-1}
              data-testid="announcement-photos"
              onChange={(e) => {
                addFiles(e.target.files, "photo");
                e.target.value = "";
              }}
            />
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              aria-label={t("addPdf")}
              tabIndex={-1}
              data-testid="announcement-pdfs"
              onChange={(e) => {
                addFiles(e.target.files, "pdf");
                e.target.value = "";
              }}
            />
            <p className="mt-1.5 text-[13px] text-faint">{t("filesHint")}</p>
            {existing.length || files.length ? (
              <ul className="mt-2 space-y-1.5">
                {existing.map((x) => (
                  <FileRow key={x.id} name={x.name} pdf={x.kind === "pdf"} onRemove={() => setRemoved((s) => [...s, x.id])} label={t("removeFile")} />
                ))}
                {files.map((x, i) => (
                  <FileRow
                    key={`${x.name}-${i}`}
                    name={x.name}
                    pdf={x.type === "application/pdf"}
                    onRemove={() => setFiles((s) => s.filter((_, j) => j !== i))}
                    label={t("removeFile")}
                  />
                ))}
              </ul>
            ) : null}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="announcement-submit">
            {busy ? t("publishing") : announcement ? t("save") : t("publish")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileRow({ name, pdf, onRemove, label }: { name: string; pdf: boolean; onRemove: () => void; label: string }) {
  const Icon = pdf ? FileText : ImagePlus;
  return (
    <li className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-muted pl-3 text-sm">
      <Icon className="size-4 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <button type="button" onClick={onRemove} aria-label={label} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-faint hover:text-text">
        <X className="size-4" />
      </button>
    </li>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, FileUp, FileText, ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { CHILD_CATEGORIES, DOCUMENT_ACCEPT, DOCUMENT_TYPES, MAX_DOCUMENT_SIZE, STAFF_DOC_TYPES, isHeic } from "@/lib/documents-logic";
import { prepareDocumentFile } from "@/lib/heic";
import { uploadChildDocumentAction, uploadStaffDocumentAction } from "@/app/(app)/documents/actions";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

type Props =
  | { kind: "child"; childId: string; defaultCategory?: string; who?: string }
  | { kind: "staff"; userId: string; defaultType?: string; who?: string };

/**
 * «Загрузить»: pick a file (or take a photo on a phone), choose the category/type (+ expiry for staff),
 * optional title. HEIC photos are converted to JPEG here before upload; the server re-checks everything.
 */
export function UploadDocumentButton(props: Props & { size?: "sm" | "md"; className?: string }) {
  const t = useTranslations("documents");
  const te = useTranslations("errors");
  const offline = useOfflineGuard();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState<null | "converting" | "uploading">(null);
  const [error, setError] = React.useState<string | null>(null);

  const pick = (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setError(null);
    if (!isHeic(f) && !DOCUMENT_TYPES[f.type]) {
      setFile(null);
      setError(te("fileType"));
      return;
    }
    if (f.size > MAX_DOCUMENT_SIZE) {
      setFile(null);
      setError(te("fileTooLarge"));
      return;
    }
    setFile(f);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setError(t("chooseFirst"));
      return;
    }
    if (offline.blocked()) return;
    const fd = new FormData(e.currentTarget);
    fd.delete("pick");
    fd.delete("camera");
    try {
      let ready = file;
      if (isHeic(file)) {
        setBusy("converting");
        ready = await prepareDocumentFile(file);
      }
      if (ready.size > MAX_DOCUMENT_SIZE) throw new Error("fileTooLarge");
      fd.set("file", ready);
      setBusy("uploading");
      const res = props.kind === "child" ? await uploadChildDocumentAction(fd) : await uploadStaffDocumentAction(fd);
      if (!res.ok) {
        toast.error(te.has(res.error) ? te(res.error) : te("generic"));
        return;
      }
      toast.success(t("uploaded"));
      setOpen(false);
      setFile(null);
      router.refresh();
    } catch (err) {
      if (offline.failed(err)) return;
      console.error(err);
      toast.error(err instanceof Error && err.message === "fileTooLarge" ? te("fileTooLarge") : te("fileType"));
    } finally {
      setBusy(null);
    }
  }

  const isPdf = file?.type === "application/pdf";
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setFile(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size={props.size ?? "md"} className={props.className} data-testid="doc-upload">
          <Upload /> {t("upload")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("uploadTitle")} description={props.who}>
        <form className="space-y-5" onSubmit={submit} data-testid="doc-upload-form">
          {props.kind === "child" ? (
            <input type="hidden" name="childId" value={props.childId} />
          ) : (
            <input type="hidden" name="userId" value={props.userId} />
          )}
          <div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-surface-muted p-3 text-center text-sm font-semibold text-text hover:border-brand">
                <FileUp className="size-6 text-sky-strong" aria-hidden />
                {t("chooseFile")}
                <input
                  type="file"
                  name="pick"
                  accept={DOCUMENT_ACCEPT}
                  className="sr-only"
                  data-testid="doc-file"
                  onChange={(e) => pick(e.target.files)}
                />
              </label>
              <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-surface-muted p-3 text-center text-sm font-semibold text-text hover:border-brand">
                <Camera className="size-6 text-sky-strong" aria-hidden />
                {t("takePhoto")}
                <input
                  type="file"
                  name="camera"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  data-testid="doc-camera"
                  onChange={(e) => pick(e.target.files)}
                />
              </label>
            </div>
            {file ? (
              <p className="mt-2 flex items-center gap-2 truncate rounded-xl bg-sky-soft px-3 py-2 text-sm text-sky-strong" data-testid="doc-picked">
                {isPdf ? <FileText className="size-4 shrink-0" aria-hidden /> : <ImageIcon className="size-4 shrink-0" aria-hidden />}
                <span className="truncate">{file.name}</span>
              </p>
            ) : (
              <p className={error ? "mt-1.5 text-[13px] text-danger" : "mt-1.5 text-[13px] text-faint"} role={error ? "alert" : undefined}>
                {error ?? t("fileHint")}
              </p>
            )}
          </div>
          {props.kind === "child" ? (
            <Field label={t("category")} htmlFor="doc-category">
              <Select id="doc-category" name="category" defaultValue={props.defaultCategory ?? "medical"} data-testid="doc-category">
                {CHILD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("type")} htmlFor="doc-type">
                <Select id="doc-type" name="type" defaultValue={props.defaultType ?? "med_book"} data-testid="doc-type">
                  {STAFF_DOC_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {t(`types.${c}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("expiresOn")} htmlFor="doc-expires" hint={t("expiresOnHint")}>
                <Input id="doc-expires" name="expiresOn" type="date" data-testid="doc-expires" />
              </Field>
            </div>
          )}
          <Field label={t("docTitle")} htmlFor="doc-title" hint={t("docTitleHint")}>
            <Input id="doc-title" name="title" maxLength={200} placeholder={t("titlePlaceholder")} data-testid="doc-title" />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!!busy} data-testid="doc-upload-submit">
            {busy === "converting" ? t("converting") : busy === "uploading" ? t("uploading") : t("upload")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

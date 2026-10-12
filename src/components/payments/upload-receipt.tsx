"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { uploadReceiptAction } from "@/app/(app)/payments/actions";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/payments";
import { cn } from "@/lib/utils";

const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

/** iPhone photos are HEIC: convert to JPEG in the browser before uploading (the server accepts JPEG/PNG/WebP/PDF). */
async function normalize(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
}

/** «Загрузить чек»: opens the file picker and uploads right away — one tap for the parent. */
export function UploadReceiptButton({
  invoiceId,
  again,
  className,
  variant = "primary",
  size = "lg",
}: {
  invoiceId: string;
  again?: boolean;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const t = useTranslations("payments");
  const te = useTranslations("errors");
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  // true once hydrated (the file input's onChange is attached) — tests wait for data-ready.
  const ready = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  async function onFile(raw: File | undefined) {
    if (!raw) return;
    if (!navigator.onLine) {
      toast.error(te("offline"));
      return;
    }
    setBusy(true);
    try {
      const file = await normalize(raw);
      if (!RECEIPT_TYPES[file.type]) throw new Error("fileType");
      if (file.size > RECEIPT_MAX_BYTES) throw new Error("fileTooLarge");
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadReceiptAction(invoiceId, fd);
      if (!res.ok) throw new Error(res.error);
      toast.success(t("uploaded"));
      router.refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "generic";
      toast.error(te.has(code) ? te(code) : te("generic"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
        data-testid="receipt-file"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn(className)}
        disabled={busy}
        data-testid="upload-receipt"
        data-ready={ready}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? t("uploading") : again ? t("uploadAgain") : t("uploadReceipt")}
      </Button>
    </>
  );
}

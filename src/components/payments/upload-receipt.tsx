"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { commitReceiptAction, prepareReceiptAction } from "@/app/(app)/payments/actions";
import { directUpload } from "@/lib/upload-client";
import { RECEIPT_MAX_BYTES } from "@/lib/payments";
import { prepareDocumentFile } from "@/lib/heic";
import { cn } from "@/lib/utils";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

/** «Загрузить чек»: opens the file picker and uploads right away — one tap for the parent. */
export function UploadReceiptButton({
  invoiceId,
  again,
  another,
  className,
  variant = "primary",
  size = "lg",
}: {
  invoiceId: string;
  again?: boolean;
  /** A receipt is already waiting for review: «Загрузить другой чек». */
  another?: boolean;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const t = useTranslations("payments");
  const te = useTranslations("errors");
  const offline = useOfflineGuard();
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
    if (offline.blocked()) return;
    setBusy(true);
    try {
      // iPhone photos are HEIC: converted to JPEG here; the server checks the real type from the file's bytes.
      const file = await prepareDocumentFile(raw);
      if (file.size > RECEIPT_MAX_BYTES) throw new Error("fileTooLarge");
      // The bytes go straight to storage (D-035); the server checks the stored file before writing the receipt.
      const res = await directUpload(
        file,
        (f) => prepareReceiptAction(invoiceId, f),
        (ticket) => commitReceiptAction(invoiceId, ticket),
      );
      if (!res.ok) throw new Error(res.error);
      toast.success(t("uploaded"));
      router.refresh();
    } catch (e) {
      if (offline.failed(e)) return;
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
        {busy ? t("uploading") : again ? t("uploadAgain") : another ? t("uploadAnother") : t("uploadReceipt")}
      </Button>
    </>
  );
}

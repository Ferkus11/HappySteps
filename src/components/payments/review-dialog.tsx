"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, ExternalLink, FileText, Loader2, Undo2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { receiptUrlAction, revertReceiptAction, reviewReceiptAction } from "@/app/(app)/payments/actions";
import { formatMoney } from "@/lib/format";

export interface ReviewReceipt {
  id: string;
  childName: string;
  subtitle: string; // "Октябрь 2026 · Загружен 12.10.2026 14:05"
  pending: boolean;
  toPay: number;
}

/**
 * Opens a receipt (image/PDF via a short signed URL); owner/accountant confirm the amount or reject with a reason,
 * and can undo a decision (back to «На проверке», with a reason — audited as receipt.revert).
 */
export function ReviewDialog({
  receipt,
  canReview,
  label,
  variant = "primary",
  size = "sm",
}: {
  receipt: ReviewReceipt;
  canReview: boolean;
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const t = useTranslations("payments");
  const te = useTranslations("errors");
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<{ url: string; mime: string } | null>(null);
  const [fileError, setFileError] = React.useState(false);
  const [mode, setMode] = React.useState<"confirm" | "reject" | "revert">("confirm");
  const [amount, setAmount] = React.useState(String(Math.round(receipt.toPay) || ""));
  const [reason, setReason] = React.useState("");
  const review = useAction(reviewReceiptAction, {
    success: mode === "confirm" ? t("confirmedToast") : t("rejectedToast"),
    onSuccess: () => setOpen(false),
  });
  const revert = useAction(revertReceiptAction, { success: t("revertedToast"), onSuccess: () => setOpen(false) });

  const loadSeq = React.useRef(0);
  function loadFile() {
    const seq = ++loadSeq.current;
    setFile(null);
    setFileError(false);
    receiptUrlAction(receipt.id).then((r) => {
      if (seq !== loadSeq.current) return;
      if (r.ok) setFile(r.data);
      else setFileError(true);
    });
  }

  const reviewable = canReview && receipt.pending;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          loadFile();
          setMode("confirm");
          setReason("");
          setAmount(String(Math.round(receipt.toPay) || ""));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size} data-testid="open-receipt">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("reviewTitle", { child: receipt.childName })} description={receipt.subtitle} side="right">
        <div className="grid min-h-48 place-items-center overflow-hidden rounded-2xl bg-surface-muted" data-testid="receipt-preview">
          {fileError ? (
            <p className="p-6 text-sm text-danger">{te("generic")}</p>
          ) : !file ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("loadingFile")}
            </p>
          ) : file.mime === "application/pdf" ? (
            <div className="flex w-full flex-col items-center gap-3 p-6">
              <FileText className="size-10 text-sky-strong" aria-hidden />
              <span className="text-sm font-semibold">{t("pdfFile")}</span>
              <Button asChild variant="secondary">
                <a href={file.url} target="_blank" rel="noreferrer" data-testid="receipt-open-file">
                  <ExternalLink /> {t("openFile")}
                </a>
              </Button>
            </div>
          ) : (
            <a href={file.url} target="_blank" rel="noreferrer" className="block w-full" title={t("openFile")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
              <img src={file.url} alt={t("reviewTitle", { child: receipt.childName })} className="mx-auto max-h-[55dvh] w-auto object-contain" data-testid="receipt-image" />
            </a>
          )}
        </div>

        {reviewable ? (
          mode === "confirm" ? (
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                review.run(receipt.id, { accept: true, amount: Number(amount.replace(/\s/g, "").replace(",", ".")) });
              }}
            >
              <Field label={t("confirmedLabel")} htmlFor="r-amount" hint={t("confirmedHint", { amount: formatMoney(receipt.toPay) })} error={review.fieldError("amount")}>
                <Input
                  id="r-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-lg font-bold"
                  data-testid="confirmed-amount"
                  required
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:grid sm:grid-cols-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setMode("reject")} data-testid="receipt-reject">
                  <XCircle /> {t("reject")}
                </Button>
                <Button type="submit" size="lg" disabled={review.pending} data-testid="receipt-confirm">
                  <CheckCircle2 /> {t("confirm")}
                </Button>
              </div>
            </form>
          ) : (
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                review.run(receipt.id, { accept: false, reason });
              }}
            >
              <Field label={t("reasonLabel")} htmlFor="r-reason" error={review.fieldError("reason")}>
                <Textarea
                  id="r-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("reasonPlaceholder")}
                  maxLength={500}
                  data-testid="reject-reason"
                  autoFocus
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:grid sm:grid-cols-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setMode("confirm")}>
                  {t("confirm")}
                </Button>
                <Button type="submit" variant="danger" size="lg" disabled={review.pending} data-testid="reject-submit">
                  {t("rejectSubmit")}
                </Button>
              </div>
            </form>
          )
        ) : receipt.pending ? (
          <p className="mt-4 text-sm text-muted" data-testid="view-only">
            {t("viewOnly")}
          </p>
        ) : canReview ? (
          mode === "revert" ? (
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                revert.run(receipt.id, { reason });
              }}
            >
              <p className="text-sm text-muted">{t("revertHint")}</p>
              <Field label={t("revertReason")} htmlFor="r-revert" error={revert.fieldError("reason")}>
                <Textarea
                  id="r-revert"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("revertPlaceholder")}
                  maxLength={500}
                  data-testid="revert-reason"
                  autoFocus
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" disabled={revert.pending} data-testid="revert-submit">
                <Undo2 /> {t("revertSubmit")}
              </Button>
            </form>
          ) : (
            <Button type="button" variant="outline" className="mt-5 w-full" onClick={() => setMode("revert")} data-testid="receipt-revert">
              <Undo2 /> {t("revert")}
            </Button>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

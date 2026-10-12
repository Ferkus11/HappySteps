"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { adjustInvoiceAction } from "@/app/(app)/payments/actions";

/** Owner/accountant: change one invoice's amount; the comment is mandatory (audited as invoice.adjust). */
export function AdjustDialog({ invoiceId, amount, description }: { invoiceId: string; amount: number; description: string }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const a = useAction(adjustInvoiceAction, { success: t("adjusted"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="adjust-invoice">
          <Pencil /> {t("adjust")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("adjustTitle")} description={description}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            a.run(invoiceId, { amount: String(f.get("amount") ?? "").replace(/\s/g, "").replace(",", "."), comment: String(f.get("comment") ?? "") });
          }}
        >
          <Field label={t("newAmount")} htmlFor="adj-amount" error={a.fieldError("amount")}>
            <Input id="adj-amount" name="amount" inputMode="decimal" defaultValue={String(Math.round(amount))} required data-testid="adjust-amount" />
          </Field>
          <Field label={t("adjustComment")} htmlFor="adj-comment" hint={t("adjustCommentHint")} error={a.fieldError("comment")}>
            <Textarea id="adj-comment" name="comment" placeholder={t("adjustPlaceholder")} maxLength={500} data-testid="adjust-comment" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={a.pending} data-testid="adjust-submit">
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

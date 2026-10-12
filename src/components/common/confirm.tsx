"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Confirmation dialog; optionally requires typing a phrase (e.g. the kindergarten name). */
export function Confirm({
  trigger,
  title,
  description,
  confirmLabel,
  danger,
  requireText,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => Promise<unknown> | void;
}) {
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const ok = !requireText || text.trim() === requireText.trim();
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setText(""); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        {requireText ? (
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={requireText} aria-label={requireText} data-testid="confirm-text" />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!ok || busy}
            data-testid="confirm-ok"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

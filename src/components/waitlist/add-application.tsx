"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { createApplicationAction } from "@/app/(app)/waitlist/actions";
import { ApplicationFields, readApplication } from "./application-fields";

/** «Добавить заявку» — e.g. a parent called the kindergarten. */
export function AddApplicationButton({ today }: { today: string }) {
  const t = useTranslations("waitlist");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const { run, pending, fieldError } = useAction(createApplicationAction, {
    success: t("added"),
    refresh: false,
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/waitlist/${d.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="wl-add">
          <Plus /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("addTitle")} side="right">
        <form
          ref={formRef}
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(readApplication(formRef.current!));
          }}
        >
          <ApplicationFields idPrefix="wl-add" today={today} fieldError={fieldError} />
          <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="wl-add-submit">
            {tc("add")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

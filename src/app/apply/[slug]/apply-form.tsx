"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationFields, readApplication } from "@/components/waitlist/application-fields";
import { useAction } from "@/hooks/use-action";
import { submitApplicationAction } from "./actions";

export function ApplyForm({ slug, today }: { slug: string; today: string }) {
  const t = useTranslations("waitlist.public");
  const formRef = React.useRef<HTMLFormElement>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formKey, setFormKey] = React.useState(0);
  const { run, pending, fieldError } = useAction(submitApplicationAction, { refresh: false });

  if (sentTo) {
    return (
      <div className="py-4 text-center" data-testid="apply-thanks" role="status">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-8" aria-hidden />
        </div>
        <h2 className="text-xl font-extrabold">{t("thanksTitle")}</h2>
        <p className="mt-2 text-muted">{t("thanksText", { phone: sentTo })}</p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            setSentTo(null);
            setFormKey((k) => k + 1);
          }}
          data-testid="apply-another"
        >
          {t("another")}
        </Button>
      </div>
    );
  }

  return (
    <form
      key={formKey}
      ref={formRef}
      className="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const form = formRef.current!;
        const values = readApplication(form);
        const website = String(new FormData(form).get("website") ?? "");
        const res = await run(slug, { ...values, website });
        if (res?.ok) setSentTo(values.parentPhone);
      }}
    >
      <ApplicationFields idPrefix="apply" today={today} fieldError={fieldError} size="lg" />
      {/* Honeypot: hidden from people and screen readers, bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="apply-website">{t("honeypot")}</label>
        <input id="apply-website" name="website" type="text" tabIndex={-1} autoComplete="off" data-testid="apply-website" />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="apply-submit">
        {pending ? t("sending") : t("submit")}
      </Button>
      <p className="text-center text-xs text-faint">{t("privacy")}</p>
    </form>
  );
}

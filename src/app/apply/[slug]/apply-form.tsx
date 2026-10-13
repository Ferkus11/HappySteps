"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApplicationFields, readApplication } from "@/components/waitlist/application-fields";
import { submitApplicationAction } from "./actions";

export function ApplyForm({ slug, today }: { slug: string; today: string }) {
  const t = useTranslations("waitlist.public");
  const formRef = React.useRef<HTMLFormElement>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formKey, setFormKey] = React.useState(0);
  const te = useTranslations("errors");
  // No toast here: on a phone it covers the header. The summary sits right above the button the visitor pressed.
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const message = (key: string) => (te.has(key) ? te(key) : te("generic"));
  const fieldError = (name: string) => (fieldErrors[name] ? message(fieldErrors[name]) : undefined);

  const submit = (slugArg: string, values: ReturnType<typeof readApplication> & { website: string }) =>
    start(async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setError("offline");
        return;
      }
      try {
        const res = await submitApplicationAction(slugArg, values);
        if (res.ok) {
          setError(null);
          setFieldErrors({});
          setSentTo(values.parentPhone);
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          setError(res.error);
        }
      } catch (e) {
        console.error(e);
        setError("generic");
      }
    });

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
            setError(null);
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
      onSubmit={(e) => {
        e.preventDefault();
        const form = formRef.current!;
        const values = readApplication(form);
        const website = String(new FormData(form).get("website") ?? "");
        submit(slug, { ...values, website });
      }}
    >
      <ApplicationFields idPrefix="apply" today={today} fieldError={fieldError} size="lg" />
      {/* Honeypot: hidden from people and screen readers, bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="apply-website">{t("honeypot")}</label>
        <input id="apply-website" name="website" type="text" tabIndex={-1} autoComplete="off" data-testid="apply-website" />
      </div>
      {error ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-danger-soft p-4 text-sm font-semibold text-danger" role="alert" data-testid="apply-error">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{message(error)}</p>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="apply-submit">
        {pending ? t("sending") : t("submit")}
      </Button>
      <p className="text-center text-xs text-faint">{t("privacy")}</p>
    </form>
  );
}

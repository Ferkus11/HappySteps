"use client";

import { useTranslations } from "next-intl";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";

/** Fields of an application — the public form and «Добавить заявку» use the same set. */
export function ApplicationFields({
  idPrefix,
  today,
  fieldError,
  size = "md",
}: {
  idPrefix: string;
  today: string;
  fieldError: (name: string) => string | undefined;
  size?: "md" | "lg";
}) {
  const t = useTranslations("waitlist");
  const big = size === "lg" ? "h-12 text-base" : undefined;
  const minBirth = `${Number(today.slice(0, 4)) - 8}${today.slice(4)}`;
  const optional = <span className="font-normal text-faint"> · {t("public.optional")}</span>;
  return (
    <>
      <Field label={t("childName")} htmlFor={`${idPrefix}-child`} error={fieldError("childName")}>
        <Input id={`${idPrefix}-child`} name="childName" required autoComplete="off" className={big} data-testid="wl-child-name" />
      </Field>
      <Field label={t("childBirthDate")} htmlFor={`${idPrefix}-birth`} error={fieldError("childBirthDate")}>
        <Input id={`${idPrefix}-birth`} name="childBirthDate" type="date" required min={minBirth} max={today} className={big} data-testid="wl-child-birth" />
      </Field>
      <Field label={t("parentName")} htmlFor={`${idPrefix}-parent`} error={fieldError("parentName")}>
        <Input id={`${idPrefix}-parent`} name="parentName" required autoComplete="name" className={big} data-testid="wl-parent-name" />
      </Field>
      <Field label={t("parentPhone")} htmlFor={`${idPrefix}-phone`} error={fieldError("parentPhone")}>
        <PhoneInput id={`${idPrefix}-phone`} name="parentPhone" required className={big} data-testid="wl-parent-phone" />
      </Field>
      <Field
        label={
          <>
            {t("desiredDate")}
            {optional}
          </>
        }
        htmlFor={`${idPrefix}-desired`}
        error={fieldError("desiredDate")}
      >
        <Input id={`${idPrefix}-desired`} name="desiredDate" type="date" min={today} className={big} data-testid="wl-desired" />
      </Field>
      <Field
        label={
          <>
            {t("comment")}
            {optional}
          </>
        }
        htmlFor={`${idPrefix}-comment`}
        hint={t("commentHint")}
        error={fieldError("comment")}
      >
        <Textarea id={`${idPrefix}-comment`} name="comment" rows={3} maxLength={1000} data-testid="wl-comment" />
      </Field>
    </>
  );
}

/** Reads the fields above from a form. */
export function readApplication(form: HTMLFormElement) {
  const f = new FormData(form);
  return {
    childName: String(f.get("childName") ?? ""),
    childBirthDate: String(f.get("childBirthDate") ?? ""),
    parentName: String(f.get("parentName") ?? ""),
    parentPhone: String(f.get("parentPhone") ?? ""),
    desiredDate: String(f.get("desiredDate") ?? ""),
    comment: String(f.get("comment") ?? ""),
  };
}

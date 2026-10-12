"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { acceptInviteAction, type InviteState } from "./actions";

export function InviteForm({ token, phone }: { token: string; phone: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = React.useActionState<InviteState, FormData>(acceptInviteAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label={t("phone")}>
        <Input value={phone} readOnly disabled />
      </Field>
      <Field label={t("newPassword")} htmlFor="password" hint={t("passwordMin")} error={state.error === "passwordMin" ? t("passwordMin") : undefined}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field
        label={t("repeatPassword")}
        htmlFor="password2"
        error={state.error === "passwordsMismatch" ? t("passwordsMismatch") : state.error === "inviteInvalid" ? t("inviteInvalid") : undefined}
      >
        <Input id="password2" name="password2" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="invite-submit">
        {t("setPassword")}
      </Button>
    </form>
  );
}

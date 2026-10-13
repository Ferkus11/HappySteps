"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string | null }) {
  const t = useTranslations("auth");
  const [state, action, pending] = React.useActionState<LoginState, FormData>(loginAction, {});
  // A full load: `next` can be a route handler (/notifications/<id>/open), which a client-side navigation can't follow.
  React.useEffect(() => {
    if (state.redirectTo) window.location.replace(new URL(state.redirectTo, window.location.origin).href);
  }, [state.redirectTo]);
  const error = state.error
    ? state.error === "tooManyAttempts"
      ? t("tooManyAttempts", { minutes: state.retryMinutes ?? 15 })
      : t(state.error)
    : undefined;
  return (
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label={t("phone")} htmlFor="phone">
        <PhoneInput id="phone" name="phone" required defaultValue={state.phone} aria-invalid={!!error} />
      </Field>
      <Field label={t("password")} htmlFor="password" error={error}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} aria-invalid={!!error} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo} data-testid="login-submit">
        {t("submit")}
      </Button>
    </form>
  );
}

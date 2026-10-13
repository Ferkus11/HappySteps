"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BellRing, Smartphone } from "lucide-react";
import type { Role } from "@/lib/auth/roles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePush } from "./use-push";

export const PUSH_PROMPT_DISMISSED_KEY = "hs_push_prompt_dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Dashboard card «Включите уведомления» — once per device, until enabled or dismissed. Shown only where push can
 * actually be switched on (supported, permission not denied). On iPhone outside the installed app push needs the
 * Home Screen app: parents already get the install sheet, staff see a hint that leads to the steps in the profile.
 */
export function PushPrompt({ publicKey, role }: { publicKey: string | null; role: Role }) {
  const t = useTranslations("notifications.prompt");
  const { state, busy, enable } = usePush(publicKey);
  const [dismissedNow, setDismissed] = React.useState(false);
  // Read only once the device state is known (after hydration, so server and client render the same: nothing).
  const dismissed = dismissedNow || (state !== "loading" && readDismissed());

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
    } catch {
      // blocked storage: the card simply comes back next time
    }
  };

  const ios = state === "ios" && role !== "parent";
  if (dismissed || (state !== "off" && !ios)) return null;
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center" data-testid="push-prompt" data-state={state}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          {ios ? <Smartphone className="size-5" aria-hidden /> : <BellRing className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-text">{t(ios ? "iosTitle" : "title")}</h2>
          <p className="mt-0.5 text-sm text-muted">{t(ios ? "iosText" : "text")}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={dismiss} data-testid="push-prompt-dismiss" className="h-11 flex-1 sm:flex-none">
          {t("later")}
        </Button>
        {ios ? (
          <Button asChild variant="secondary" className="h-11 flex-1 sm:flex-none">
            <Link href="/profile" data-testid="push-prompt-ios">
              {t("iosAction")}
            </Link>
          </Button>
        ) : (
          <Button onClick={enable} disabled={busy} data-testid="push-prompt-enable" className="h-11 flex-1 sm:flex-none">
            <BellRing aria-hidden />
            {t("enable")}
          </Button>
        )}
      </div>
    </Card>
  );
}

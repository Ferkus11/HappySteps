"use client";

import { useTranslations } from "next-intl";
import { BellOff, BellRing, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePush } from "./use-push";

/**
 * Push on this device: unsupported / iOS outside the installed app / blocked / on / off.
 * Enabling asks for permission from the button press (a user gesture, required by Safari).
 */
export function PushCard({ publicKey, quiet }: { publicKey: string | null; quiet: { start: string; end: string } | null }) {
  const t = useTranslations("notifications.push");
  const { state, busy, enable, disable } = usePush(publicKey);

  const text = state === "loading" ? "" : t(state);
  const Icon = state === "on" ? BellRing : state === "ios" ? Smartphone : BellOff;
  return (
    <div className="rounded-2xl bg-sky-soft/60 p-4" data-testid="push-card" data-state={state}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-sky-strong">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-bold text-text">{t("title")}</p>
            {state === "on" ? <Badge tone="success">{t("enabledShort")}</Badge> : null}
          </div>
          <p className="mt-1 min-h-5 text-sm text-muted" data-testid="push-state-text">
            {text}
          </p>
          {state === "on" && quiet ? <p className="mt-1 text-xs text-faint">{t("quietHint", quiet)}</p> : null}
        </div>
      </div>
      {state === "off" || state === "on" ? (
        <div className="mt-3 flex justify-end">
          {state === "off" ? (
            <Button variant="secondary" onClick={enable} disabled={busy} data-testid="push-enable" className="w-full sm:w-auto">
              <BellRing aria-hidden />
              {t("enable")}
            </Button>
          ) : (
            <Button variant="outline" onClick={disable} disabled={busy} data-testid="push-disable" className="w-full sm:w-auto">
              {t("disable")}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

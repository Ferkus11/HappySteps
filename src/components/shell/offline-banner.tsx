"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/pwa/connectivity";

/** SPEC §8 «Офлайн»: shown under the header while there is no connection; actions are blocked meanwhile. */
export function OfflineBanner() {
  const t = useTranslations("pwa");
  const online = useOnline();
  React.useEffect(() => {
    document.documentElement.dataset.offline = online ? "false" : "true";
  }, [online]);
  if (online) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="sticky top-16 z-20 flex items-center justify-center gap-2 bg-warning-soft px-4 py-2.5 text-center text-sm font-semibold text-warning"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {t("offlineBanner")}
    </div>
  );
}

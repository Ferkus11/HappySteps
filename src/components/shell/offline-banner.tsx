"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";

export function useOnline() {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const t = useTranslations("common");
  const online = useOnline();
  React.useEffect(() => {
    document.documentElement.dataset.offline = online ? "false" : "true";
  }, [online]);
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm font-semibold text-warning">
      <WifiOff className="size-4" aria-hidden />
      {t("offline")}
    </div>
  );
}

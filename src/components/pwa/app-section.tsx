"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isIos, isIosSafari, isStandalone } from "@/lib/pwa/detect";
import { usePlatform } from "@/lib/pwa/use-platform";
import { useInstallPrompt } from "@/lib/pwa/install-prompt";
import { IosInstallSteps } from "./install-steps";

type Mode = "unknown" | "installed" | "ios" | "other";

/** Profile card «Приложение»: install button (Chromium), Home Screen steps (iOS) or «already installed». */
export function AppInstallSection() {
  const t = useTranslations("pwa");
  const { canInstall, justInstalled, install } = useInstallPrompt();
  const info = usePlatform();
  const mode: Mode = !info ? "unknown" : isStandalone(info) ? "installed" : isIos(info) ? "ios" : "other";
  const safari = !info || isIosSafari(info);

  const installed = mode === "installed" || justInstalled;

  return (
    <Card data-testid="pwa-app-section">
      <CardHeader title={t("appSection")} />
      {mode === "unknown" ? (
        <div className="h-11" />
      ) : installed ? (
        <p className="flex items-center gap-2 text-[15px] font-semibold text-success" data-testid="pwa-installed">
          <CheckCircle2 className="size-5" aria-hidden /> {t("appInstalled")}
        </p>
      ) : mode === "ios" ? (
        <>
          <p className="mb-3 text-sm text-muted">{t("appIosText")}</p>
          <IosInstallSteps showSafariHint={!safari} />
        </>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-soft text-sky-strong">
              <Smartphone className="size-5" aria-hidden />
            </span>
            <p className="text-sm text-muted">{canInstall ? t("appInstallText") : `${t("appInstallText")} ${t("appManualText")}`}</p>
          </div>
          {canInstall ? (
            <Button
              variant="secondary"
              className="w-full md:w-auto"
              data-testid="pwa-install"
              onClick={async () => {
                if (await install()) toast.success(t("appInstalledToast"));
              }}
            >
              <Download /> {t("appInstall")}
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

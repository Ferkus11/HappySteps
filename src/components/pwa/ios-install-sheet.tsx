"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isIosSafari, readDismissed, shouldOfferIosInstall, writeDismissed } from "@/lib/pwa/detect";
import { usePlatform } from "@/lib/pwa/use-platform";
import { IosInstallSteps } from "./install-steps";

/**
 * SPEC §5.12: on iPhone push works only from the Home Screen app — a parent who opens the site in Safari
 * sees the «Add to Home Screen» steps once per device (until dismissed). Later: profile → «Приложение».
 */
export function IosInstallSheet() {
  const t = useTranslations("pwa");
  const info = usePlatform();
  const [open, setOpen] = React.useState(false);
  const offer = !!info && shouldOfferIosInstall(info, readDismissed());
  const safari = !info || isIosSafari(info);

  React.useEffect(() => {
    if (!offer) return;
    // Let the page settle first, so the sheet doesn't fight with the first paint.
    const id = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(id);
  }, [offer]);

  const change = (v: boolean) => {
    if (!v) writeDismissed();
    setOpen(v);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent title={t("iosTitle")} description={t("iosLead")}>
        <div data-testid="ios-install-sheet" className="pb-4">
          <IosInstallSteps showSafariHint={!safari} />
          <Button size="lg" className="mt-5 w-full" onClick={() => change(false)} data-testid="ios-install-dismiss">
            {t("iosOk")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

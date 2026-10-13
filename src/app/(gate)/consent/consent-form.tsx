"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/switch";
import { acceptConsentAction } from "./actions";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

export function ConsentForm() {
  const t = useTranslations("auth");
  const [checked, setChecked] = React.useState(false);
  const [pending, start] = React.useTransition();
  const offline = useOfflineGuard();
  return (
    <div className="mt-5 space-y-5">
      <label className="flex cursor-pointer items-start gap-3 text-[15px] font-semibold">
        <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" data-testid="consent-checkbox" />
        {t("consentCheckbox")}
      </label>
      <Button size="lg" className="w-full" disabled={!checked || pending} onClick={() => {
          if (offline.blocked()) return;
          start(() => acceptConsentAction());
        }} data-testid="consent-continue">
        {t("consentContinue")}
      </Button>
    </div>
  );
}

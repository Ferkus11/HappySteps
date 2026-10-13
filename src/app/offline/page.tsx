import { getTranslations } from "next-intl/server";
import { WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { OfflineActions } from "./offline-actions";

export async function generateMetadata() {
  return { title: (await getTranslations("pwa"))("offlineTitle") };
}

/**
 * Shown by the service worker for a page that was never opened on this device while there is no network
 * (it is precached when the worker installs). Public route — no session needed.
 */
export default async function OfflinePage() {
  const t = await getTranslations("pwa");
  const tc = await getTranslations("common");
  return (
    <div className="flex min-h-dvh flex-col bg-sky-soft">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex items-center justify-center gap-2.5">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand text-lg font-extrabold text-brand-fg">H</span>
            <span className="text-2xl font-extrabold tracking-tight">{tc("appName")}</span>
          </div>
          <Card className="p-6 text-center md:p-8" data-testid="offline-page">
            <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-warning-soft text-warning">
              <WifiOff className="size-8" aria-hidden />
            </span>
            <h1 className="mt-4 text-2xl font-extrabold">{t("offlineTitle")}</h1>
            <p className="mt-2 text-[15px] text-muted">{t("offlineText")}</p>
            <OfflineActions />
          </Card>
        </div>
      </div>
    </div>
  );
}

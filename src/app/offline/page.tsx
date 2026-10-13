import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import ruPwa from "@/messages/ru/pwa.json";
import kkPwa from "@/messages/kk/pwa.json";
import { OfflineActions } from "./offline-actions";

/** The `pwa` texts in a fixed language (the page does not follow the reader's language cookie). */
function pwaIn(locale: "ru" | "kk") {
  return createTranslator({ locale, messages: { pwa: locale === "kk" ? kkPwa : ruPwa }, namespace: "pwa" });
}

export async function generateMetadata() {
  return { title: `${pwaIn("ru")("offlineTitle")} · ${pwaIn("kk")("offlineTitle")}` };
}

/**
 * Shown by the service worker for a page that was never opened on this device while there is no network
 * (it is precached when the worker installs). Public route — no session needed. One precached copy serves
 * every reader, so it speaks both languages: Russian first, Kazakh below.
 */
export default async function OfflinePage() {
  const ru = pwaIn("ru");
  const kk = pwaIn("kk");
  const tc = await getTranslations("common");
  const both = (key: "offlineRetry" | "offlineHome" | "offlineChecking") => `${ru(key)} · ${kk(key)}`;
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
            <div lang="ru">
              <h1 className="mt-4 text-2xl font-extrabold">{ru("offlineTitle")}</h1>
              <p className="mt-2 text-[15px] text-muted">{ru("offlineText")}</p>
            </div>
            <div lang="kk" className="mt-4 border-t border-border/70 pt-4" data-testid="offline-page-kk">
              <p className="text-lg font-extrabold">{kk("offlineTitle")}</p>
              <p className="mt-1.5 text-sm text-muted">{kk("offlineText")}</p>
            </div>
            <OfflineActions labels={{ retry: both("offlineRetry"), home: both("offlineHome"), checking: both("offlineChecking") }} />
          </Card>
        </div>
      </div>
    </div>
  );
}

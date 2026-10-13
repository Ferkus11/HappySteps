"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { clearUserCaches, isSignedOutPath } from "@/lib/pwa/caches";
import { captureInstallPrompt } from "@/lib/pwa/install-prompt";

/** Production builds register the worker; NEXT_PUBLIC_ENABLE_SW=1 turns it on elsewhere, =0 turns it off. */
const SW_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SW === "1" || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_SW !== "0");
const UPDATE_TOAST_ID = "hs-sw-update";

/**
 * Root-layout companion for the PWA: registers /sw.js, offers «Обновить» when a new worker is waiting,
 * captures Chromium's install prompt for the profile and drops saved personal pages on signed-out screens.
 */
export function PwaRoot() {
  const t = useTranslations("pwa");
  const pathname = usePathname();

  React.useEffect(() => {
    if (isSignedOutPath(pathname)) void clearUserCaches();
  }, [pathname]);

  React.useEffect(() => {
    captureInstallPrompt();
  }, []);

  React.useEffect(() => {
    if (!SW_ENABLED || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    let cancelled = false;

    const offerUpdate = (worker: ServiceWorker) => {
      toast(t("updateTitle"), {
        id: UPDATE_TOAST_ID,
        description: t("updateText"),
        duration: Infinity,
        // The one action of the toast, in the brand colour and 44px tall (SPEC §8).
        classNames: { actionButton: "!h-11 !rounded-xl !bg-brand !px-4 !text-sm !font-semibold !text-brand-fg" },
        action: {
          label: t("updateAction"),
          onClick: () => {
            reloading = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };

    const watch = (reg: ServiceWorkerRegistration) => {
      // A worker already waiting from an earlier visit.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          // «installed» with an existing controller = an update; the very first install just takes over.
          if (next.state === "installed" && navigator.serviceWorker.controller) offerUpdate(next);
        });
      });
    };

    const onControllerChange = () => {
      if (reloading) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (!cancelled) watch(reg);
      })
      .catch(() => undefined); // blocked (tests, private mode) or unsupported: the app works without it

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [t]);

  return null;
}

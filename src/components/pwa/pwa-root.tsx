"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { clearUserCaches, contextChanged, isSignedOutPath } from "@/lib/pwa/caches";
import { isNetworkError, reportNetworkFailure } from "@/lib/pwa/connectivity";
import { captureInstallPrompt } from "@/lib/pwa/install-prompt";

/** Production builds register the worker; NEXT_PUBLIC_ENABLE_SW=1 turns it on elsewhere, =0 turns it off. */
const SW_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SW === "1" || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_SW !== "0");
const UPDATE_TOAST_ID = "hs-sw-update";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The app shell's `data-hs-context` (user|garden:role), or "" outside the app. */
const shellContext = () => document.querySelector("[data-hs-context]")?.getAttribute("data-hs-context") ?? "";

/**
 * A page can come from the worker's saved copy while the browser still believes it is online (Wi-Fi without
 * internet, server down). One cheap probe tells: a network failure turns on the offline banner.
 */
function probeServer() {
  if (!navigator.onLine) return;
  fetch("/api/health", { cache: "no-store" }).catch((e: unknown) => {
    if (isNetworkError(e)) reportNetworkFailure();
  });
}

/**
 * Root-layout companion for the PWA: registers /sw.js, offers «Обновить» when a new worker is waiting,
 * captures Chromium's install prompt for the profile, drops saved personal pages on signed-out screens and
 * whenever the shell's user/garden/role changes, and notices pages served from the saved copy.
 */
export function PwaRoot() {
  const t = useTranslations("pwa");
  const pathname = usePathname();

  React.useEffect(() => {
    if (isSignedOutPath(pathname)) void clearUserCaches();
  }, [pathname]);

  // Saved pages belong to one user + garden + role. The shell exposes it; a change (a push click that switched
  // the garden, a switch in another tab, another account) drops them. The attribute can change without a new
  // pathname (context switch on «/»), hence the observer.
  React.useEffect(() => {
    const check = () => {
      if (contextChanged(shellContext(), storage())) void clearUserCaches();
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-hs-context"] });
    return () => mo.disconnect();
  }, [pathname]);

  React.useEffect(() => {
    probeServer();
    const onVisible = () => {
      if (document.visibilityState === "visible") probeServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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
        // «Обновить» or «Позже» (44px each) instead of the tiny global close button.
        closeButton: false,
        // The one action of the toast, in the brand colour and 44px tall (SPEC §8).
        classNames: {
          actionButton: "!h-11 !rounded-xl !bg-brand !px-4 !text-sm !font-semibold !text-brand-fg",
          cancelButton: "!h-11 !rounded-xl !px-3 !text-sm !font-semibold",
        },
        cancel: { label: t("updateLater"), onClick: () => undefined },
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
    // The worker says it answered a navigation from the saved copy because the network failed.
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "served-from-cache") reportNetworkFailure();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages?.();

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (!cancelled) watch(reg);
      })
      .catch(() => undefined); // blocked (tests, private mode) or unsupported: the app works without it

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [t]);

  return null;
}

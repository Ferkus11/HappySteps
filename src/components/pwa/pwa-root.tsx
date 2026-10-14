"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { clearUserCaches, contextChanged, isSignedOutPath } from "@/lib/pwa/caches";
import { isNetworkError, reportNetworkFailure } from "@/lib/pwa/connectivity";
import { captureInstallPrompt } from "@/lib/pwa/install-prompt";

/** Production builds register the worker; NEXT_PUBLIC_ENABLE_SW=1 turns it on elsewhere, =0 turns it off. */
const SW_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SW === "1" || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_SW !== "0");
const UPDATE_TOAST_ID = "hs-sw-update";
/** The update offer has its own toaster: bottom right on desktop, above the tab bar on phones (UX review #11). */
const UPDATE_TOASTER_ID = "hs-update";

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
      toast.custom(
        (id) => (
          <UpdateToast
            title={t("updateTitle")}
            text={t("updateText")}
            later={t("updateLater")}
            action={t("updateAction")}
            onLater={() => toast.dismiss(id)}
            onUpdate={() => {
              reloading = true;
              worker.postMessage({ type: "SKIP_WAITING" });
              toast.dismiss(id);
            }}
          />
        ),
        { id: UPDATE_TOAST_ID, duration: Infinity, toasterId: UPDATE_TOASTER_ID },
      );
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

  return (
    <Toaster
      id={UPDATE_TOASTER_ID}
      position="bottom-right"
      customAriaLabel={t("updateRegion")}
      offset={{ bottom: 24, right: 24 }}
      // Phones: full width minus the 16px gutters, just above the 64px bottom tab bar.
      mobileOffset={{ left: 16, right: 16, bottom: "calc(80px + env(safe-area-inset-bottom))" }}
      style={{ "--width": "400px" } as React.CSSProperties}
    />
  );
}

/** «Доступна новая версия»: semibold title, the hint under it, then the two 44px buttons on their own row. */
function UpdateToast(props: { title: string; text: string; later: string; action: string; onLater: () => void; onUpdate: () => void }) {
  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4 font-sans shadow-lg" data-testid="pwa-update-toast">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden>
          <RefreshCw className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-text">{props.title}</p>
          <p className="mt-0.5 text-sm leading-snug text-muted">{props.text}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={props.onLater}>
          {props.later}
        </Button>
        <Button onClick={props.onUpdate}>{props.action}</Button>
      </div>
    </div>
  );
}

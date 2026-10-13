"use client";

import * as React from "react";

/** Chromium's install prompt event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Starts listening once, from the root layout, so the event isn't missed before the profile page opens. */
export function captureInstallPrompt() {
  if (typeof window === "undefined" || (window as { __hsInstallCapture?: boolean }).__hsInstallCapture) return;
  (window as { __hsInstallCapture?: boolean }).__hsInstallCapture = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's mini-infobar away; we offer our own button in the profile
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useInstallPrompt() {
  const canInstall = React.useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const justInstalled = React.useSyncExternalStore(subscribe, () => installed, () => false);
  const install = React.useCallback(async () => {
    const e = deferred;
    if (!e) return false;
    deferred = null;
    emit();
    await e.prompt();
    const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    return choice.outcome === "accepted";
  }, []);
  return { canInstall, justInstalled, install };
}

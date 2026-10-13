"use client";

import * as React from "react";

/**
 * Connectivity as the app sees it: the browser says it is offline, or a request just failed on the
 * network (Wi-Fi without internet, server unreachable). The second state clears itself once a
 * health probe succeeds or the browser reports it is back online.
 */

let unreachable = false;
let probe: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine && !unreachable;
}

function stopProbe() {
  if (probe) clearInterval(probe);
  probe = null;
}

function setUnreachable(v: boolean) {
  if (unreachable === v) return;
  unreachable = v;
  if (!v) stopProbe();
  emit();
}

/** Call when a request failed with a network error (see isNetworkError). */
export function reportNetworkFailure() {
  if (typeof window === "undefined") return;
  setUnreachable(true);
  if (probe) return;
  probe = setInterval(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => {
        if (r.ok) setUnreachable(false);
      })
      .catch(() => undefined);
  }, 5000);
}

export { isNetworkError } from "./network-error";

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onOnline = () => {
    setUnreachable(false);
    cb();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", cb);
  };
}

/** true while the app can reach the server (always true during SSR / hydration). */
export function useOnline(): boolean {
  return React.useSyncExternalStore(subscribe, isOnline, () => true);
}

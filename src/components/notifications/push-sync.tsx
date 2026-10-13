"use client";

import { isOnline } from "@/lib/pwa/connectivity";
import * as React from "react";
import { savePushSubscriptionAction } from "@/app/(app)/notifications/actions";
import { currentSubscription, pushSupported, toInput } from "./push-client";

const KEY = "hs_push_synced";

/**
 * Once per tab session: if this browser already has a push subscription, re-saves it for the signed-in user
 * (a browser may rotate its endpoint; another account may have signed in on this device). Silent.
 */
export function PushSync() {
  React.useEffect(() => {
    if (!pushSupported() || Notification.permission !== "granted") return;
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {
      // storage blocked — sync anyway
    }
    const timer = setTimeout(async () => {
      try {
        const sub = await currentSubscription();
        if (!sub || !isOnline()) return;
        const r = await savePushSubscriptionAction(toInput(sub));
        if (r.ok) sessionStorage.setItem(KEY, "1");
      } catch {
        // not important — the profile card can enable push again
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

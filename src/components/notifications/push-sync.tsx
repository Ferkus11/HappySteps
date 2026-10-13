"use client";

import { isOnline } from "@/lib/pwa/connectivity";
import * as React from "react";
import { savePushSubscriptionAction } from "@/app/(app)/notifications/actions";
import { currentSubscription, pushSupported, pushSyncKey, toInput } from "./push-client";

/**
 * Once per tab session and user: if this browser already has a push subscription, re-saves it for the signed-in
 * user (a browser may rotate its endpoint; another account may have signed in on this device). The marker is
 * keyed by user id and cleared on logout / context switch, so a second account in the same tab syncs too. Silent.
 */
export function PushSync({ userId }: { userId?: string }) {
  React.useEffect(() => {
    if (!userId || !pushSupported() || Notification.permission !== "granted") return;
    const key = pushSyncKey(userId);
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      // storage blocked — sync anyway
    }
    const timer = setTimeout(async () => {
      try {
        const sub = await currentSubscription();
        if (!sub || !isOnline()) return;
        const r = await savePushSubscriptionAction(toInput(sub));
        if (r.ok) sessionStorage.setItem(key, "1");
      } catch {
        // not important — the profile card can enable push again
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [userId]);
  return null;
}

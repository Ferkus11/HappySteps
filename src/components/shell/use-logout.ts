"use client";

import * as React from "react";
import { logoutAction } from "@/lib/actions/session";
import { clearUserCaches } from "@/lib/pwa/caches";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";
import { clearPushSyncMarkers, releaseDevicePush } from "@/components/notifications/push-client";

/**
 * Logout that leaves nothing personal on a shared device: saved pages, the push subscription (unsubscribed in the
 * browser, its row deleted on the server) and the push sync marker. The push part is best effort and time-boxed —
 * it never holds the logout itself.
 */
export function useLogout() {
  const { blocked } = useOfflineGuard();
  const [pending, start] = React.useTransition();
  const logout = React.useCallback(() => {
    if (blocked()) return;
    start(async () => {
      await clearUserCaches();
      clearPushSyncMarkers();
      const endpoint = await releaseDevicePush();
      await logoutAction(endpoint);
    });
  }, [blocked]);
  return { logout, pending };
}

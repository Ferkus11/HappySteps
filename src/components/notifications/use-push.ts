"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { deletePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(app)/notifications/actions";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";
import { detectPushState, subscribePush, unsubscribePush, type PushState } from "./push-client";

/**
 * Push on this device (profile card and the dashboard prompt): current state plus enable/disable.
 * `enable` must be called from a click — Safari asks for permission only from a user gesture.
 */
export function usePush(publicKey: string | null) {
  const t = useTranslations("notifications.push");
  const { blocked, failed } = useOfflineGuard();
  const [state, setState] = React.useState<PushState>("loading");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    detectPushState(publicKey)
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, [publicKey]);

  const enable = React.useCallback(async () => {
    if (!publicKey || blocked()) return;
    setBusy(true);
    try {
      const r = await subscribePush(publicKey);
      if (r === "blocked" || r === "off") {
        setState(r);
        return;
      }
      const saved = await savePushSubscriptionAction(r);
      if (!saved.ok) throw new Error(saved.error);
      setState("on");
      toast.success(t("enabled"));
    } catch (e) {
      if (failed(e)) return;
      console.error("push enable", e);
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }, [publicKey, blocked, failed, t]);

  const disable = React.useCallback(async () => {
    if (blocked()) return;
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      // The browser no longer receives pushes either way; the server row is removed when it can be.
      setState("off");
      if (endpoint) {
        const r = await deletePushSubscriptionAction(endpoint);
        if (!r.ok) throw new Error(r.error);
      }
      toast.success(t("disabled"));
    } catch (e) {
      if (failed(e)) return;
      console.error("push disable", e);
      toast.error(t("disableFailed"));
    } finally {
      setBusy(false);
    }
  }, [blocked, failed, t]);

  return { state, busy, enable, disable };
}

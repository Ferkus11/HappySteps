"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { isNetworkError } from "./network-error";
import { isOnline, reportNetworkFailure } from "./connectivity";

/** One toast id: repeated taps while offline don't stack messages. */
export const OFFLINE_TOAST_ID = "hs-offline-action";

export function showOfflineToast(message: string) {
  toast.error(message, { id: OFFLINE_TOAST_ID });
}

/**
 * For mutations that don't go through useAction (uploads, chat composer, menus):
 * `if (blocked()) return;` before calling the server, and `failed(e)` in a catch to turn a network
 * error into the same offline message (returns false for any other error).
 */
export function useOfflineGuard() {
  const te = useTranslations("errors");
  const blocked = React.useCallback(() => {
    if (isOnline()) return false;
    showOfflineToast(te("offline"));
    return true;
  }, [te]);
  const failed = React.useCallback(
    (e: unknown) => {
      if (!isNetworkError(e)) return false;
      reportNetworkFailure();
      showOfflineToast(te("offline"));
      return true;
    },
    [te],
  );
  return { blocked, failed };
}

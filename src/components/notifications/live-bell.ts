"use client";

import { isOnline } from "@/lib/pwa/connectivity";
import * as React from "react";
import { unreadNotificationsAction } from "@/app/(app)/notifications/actions";
import { subscribeAuthed, uniqueTopic } from "@/components/chats/realtime";

/** Fired by the centre after it marks rows read, so the bell follows without waiting for Realtime. */
export const NOTIFICATIONS_CHANGED = "hs:notifications-changed";

/**
 * Keeps the header bell live: the server value is adopted on every render that brings a new one; new or
 * read notifications (Realtime, RLS-filtered — own rows only) re-count it in the background.
 */
export function useLiveUnreadNotifications(initial: number | undefined): number | undefined {
  const [state, setState] = React.useState({ initial, n: initial });
  if (state.initial !== initial) setState({ initial, n: initial });

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = (delay = 500) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!isOnline()) return; // background refresh: skip while offline
        const r = await unreadNotificationsAction().catch(() => null);
        if (r?.ok) setState((s) => ({ ...s, n: r.data }));
      }, delay);
    };
    const onChanged = () => reload(0);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    const unsubscribe = subscribeAuthed(
      (supabase) =>
        supabase
          .channel(uniqueTopic("notifications-bell"))
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => reload())
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, () => reload()),
      () => reload(),
    );
    return () => {
      clearTimeout(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
      unsubscribe();
    };
  }, []);

  return state.n;
}

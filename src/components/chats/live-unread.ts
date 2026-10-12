"use client";

import * as React from "react";
import { unreadTotalAction } from "@/app/(app)/chats/actions";
import { subscribeAuthed, uniqueTopic } from "./realtime";

/**
 * Keeps the header «Чаты» badge live: the server value is adopted on every render that brings a new
 * one, and new/changed messages or read markers (Realtime, RLS-filtered) re-count it in the background.
 */
export function useLiveUnreadChats(initial: number | undefined, enabled: boolean): number | undefined {
  const [state, setState] = React.useState({ initial, n: initial });
  if (state.initial !== initial) setState({ initial, n: initial });

  React.useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await unreadTotalAction().catch(() => null);
        if (r?.ok) setState((s) => ({ ...s, n: r.data }));
      }, 800);
    };
    const unsubscribe = subscribeAuthed((supabase) =>
      supabase
        .channel(uniqueTopic("chats-unread-badge"))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, reload)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, reload)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reads" }, reload)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_reads" }, reload),
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);

  return state.n;
}

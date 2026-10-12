"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * supabase-js hands back an existing channel for a topic it still holds — e.g. one whose removal
 * after a re-render is not finished — and subscribing that never joins. Every subscription therefore
 * gets its own topic.
 */
export function uniqueTopic(name: string): string {
  return `${name}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Subscribes once the browser session is loaded: a channel joined before that would carry the anon
 * key, and RLS would (correctly) deliver nothing. `onJoined` runs on every (re)join, so the caller can
 * catch up on rows written before the channel was live. Returns the cleanup function.
 */
export function subscribeAuthed(
  build: (client: ReturnType<typeof getBrowserClient>) => RealtimeChannel,
  onJoined?: () => void,
): () => void {
  const client = getBrowserClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  void (async () => {
    const { data } = await client.auth.getSession();
    if (cancelled) return;
    if (data.session) await client.realtime.setAuth(data.session.access_token);
    if (cancelled) return;
    channel = build(client).subscribe((status) => {
      if (status === "SUBSCRIBED" && !cancelled) onJoined?.();
    });
  })();
  return () => {
    cancelled = true;
    if (channel) void client.removeChannel(channel);
  };
}

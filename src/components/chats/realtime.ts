"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * Subscribes once the browser session is loaded: a channel joined before that would carry the anon
 * key, and RLS would (correctly) deliver nothing. Returns the cleanup function.
 */
export function subscribeAuthed(build: (client: ReturnType<typeof getBrowserClient>) => RealtimeChannel): () => void {
  const client = getBrowserClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  void (async () => {
    const { data } = await client.auth.getSession();
    if (cancelled) return;
    if (data.session) await client.realtime.setAuth(data.session.access_token);
    if (cancelled) return;
    channel = build(client).subscribe();
  })();
  return () => {
    cancelled = true;
    if (channel) void client.removeChannel(channel);
  };
}

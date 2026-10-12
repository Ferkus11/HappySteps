import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES RLS. Use only for:
 *  - Auth admin API (creating users, setting passwords),
 *  - Storage (private buckets, signed URLs) after an RLS-checked lookup,
 *  - cron jobs.
 * Always check permissions explicitly before using it.
 */
export function createServiceClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Writes an audit entry as the current user (SQL function checks membership). */
export async function audit(
  supabase: SupabaseClient,
  kindergartenId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  const { error } = await supabase.rpc("log_action", {
    kg: kindergartenId,
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId,
    p_details: details,
  });
  if (error) console.error("audit failed", action, error.message);
}

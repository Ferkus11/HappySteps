import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The single place where subscription status is checked (SPEC §10).
 * For now everything passes except a blocked kindergarten or a `blocked` subscription.
 * Plan limits (lib/plans.ts) are configuration only and are not enforced yet.
 */
export async function checkSubscription(kindergartenId: string, kgStatus: "active" | "blocked") {
  if (kgStatus === "blocked") return { allowed: false as const, reason: "kindergarten_blocked" as const };
  const { data } = await createServiceClient()
    .from("subscriptions")
    .select("status, plan, current_period_end")
    .eq("kindergarten_id", kindergartenId)
    .maybeSingle();
  if (data?.status === "blocked") return { allowed: false as const, reason: "subscription_blocked" as const };
  return { allowed: true as const, status: data?.status ?? "trial", plan: data?.plan ?? "trial" };
}

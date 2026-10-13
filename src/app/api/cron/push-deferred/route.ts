import { cronUnauthorized } from "@/lib/cron";
import { deliverDeferred } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Every 5 minutes: sends the pushes that waited for the end of a garden's quiet hours
 * (`notifications.deliver_after`). Idempotent — rows are claimed atomically (`pushed_at`), so a repeated
 * or overlapping run sends nothing twice.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, ...(await deliverDeferred()) });
  } catch (e) {
    console.error("push-deferred", e instanceof Error ? e.message : e);
    return Response.json({ error: "db" }, { status: 500 });
  }
}

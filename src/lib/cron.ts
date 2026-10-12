import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Cron endpoints (`/api/cron/<job>`) are called by Vercel Cron / system cron with
 * `Authorization: Bearer $CRON_SECRET`. Returns a 401 response when the secret does not match.
 */
export function cronUnauthorized(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

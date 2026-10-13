/**
 * Cache Storage names shared with public/sw.js (kept in sync by tests/unit/pwa.test.ts).
 * Pages viewed by a signed-in user live in `hs-pages-*` and are personal: they are removed on logout and
 * whenever a signed-out page (login / invite) is shown. Static assets and the offline page are not personal.
 */
export const USER_CACHE_PREFIX = "hs-pages-";

/** Signed-out screens: reaching one means the previous user's pages must not stay on the device. */
export const SIGNED_OUT_PREFIXES = ["/login", "/invite"];

export function isSignedOutPath(pathname: string): boolean {
  return SIGNED_OUT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function clearUserCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(USER_CACHE_PREFIX)).map((k) => caches.delete(k)));
  } catch {
    // Cache Storage unavailable (private mode, insecure origin): nothing was cached either.
  }
}

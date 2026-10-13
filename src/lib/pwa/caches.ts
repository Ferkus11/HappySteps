/**
 * Cache Storage names shared with public/sw.js (kept in sync by tests/unit/pwa.test.ts).
 * Pages viewed by a signed-in user live in `hs-pages-*` and are personal: they are removed on logout and
 * whenever a signed-out page (login / invite) is shown. Static assets and the offline page are not personal.
 */
export const USER_CACHE_PREFIX = "hs-pages-";

/**
 * Signed-out / gate screens: reaching one means the previous user's pages must not stay on the device
 * (login, invite; no access and blocked garden — the session may belong to someone else by now).
 */
export const SIGNED_OUT_PREFIXES = ["/login", "/invite", "/no-access", "/blocked"];

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

/** localStorage key of the last personal-data context seen on this device (`user|garden:role`). */
export const CONTEXT_KEY = "hs_last_context";

/**
 * Records the context the app shell shows now (its `data-hs-context`) and says whether it differs from the last
 * one seen on this device — then the saved pages belong to another user, garden or role and must go.
 * Also catches switches the client did not make itself (a push click that changes the garden, another tab).
 * Without storage it reports no change (the logout / sign-in screens still clear the caches).
 */
export function contextChanged(current: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!current || !storage) return false;
  try {
    const prev = storage.getItem(CONTEXT_KEY);
    if (prev === current) return false;
    storage.setItem(CONTEXT_KEY, current);
    return true;
  } catch {
    return false;
  }
}

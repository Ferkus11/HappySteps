/**
 * A same-origin app path only (no `//host`, no `/\host`, no scheme) — for links stored in notifications and the
 * `next` parameter of the login page. Client-safe.
 */
export function safeAppPath(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return null;
  return url;
}

const BASE = "http://app.invalid";

/**
 * Where to go after signing in: a same-origin path (also after the URL parser's normalisation — tabs, newlines
 * and backslashes cannot smuggle in another host), never back to the login page. Null otherwise.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  if (!safeAppPath(raw) || /[\u0000-\u001f\\]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (u.origin !== BASE) return null;
  if (u.pathname === "/login" || u.pathname.startsWith("/login/")) return null;
  return u.pathname + u.search + u.hash;
}

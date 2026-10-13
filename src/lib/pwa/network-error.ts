/**
 * Whether a thrown value is a network failure (no connection / host unreachable) rather than a server error.
 * Browsers word it differently: Chrome «Failed to fetch», Safari «Load failed», Firefox «NetworkError when …».
 */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|network error/i.test(e.message);
}

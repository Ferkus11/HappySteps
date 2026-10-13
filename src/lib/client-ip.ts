/**
 * The client's IP for rate limits — never trust what the client itself can write.
 *
 * - On Vercel (`VERCEL=1`): `x-vercel-forwarded-for` / `x-real-ip`, which Vercel's edge overwrites.
 * - Elsewhere: `x-forwarded-for` read from the right. Every trusted proxy in front of the app appends the address
 *   it saw, so the entry at position `TRUSTED_PROXY_HOPS` (default 1) from the right is the client as seen by the
 *   outermost trusted proxy; anything further left was sent by the client and may be forged.
 * - No usable header → null (callers decide what an unknown IP means).
 */
type HeaderBag = { get(name: string): string | null };
type Env = Record<string, string | undefined>;

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return IP_RE.test(s) ? s : null;
}

export function trustedProxyHops(env: Env = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

export function clientIp(h: HeaderBag, env: Env = process.env): string | null {
  if (env.VERCEL === "1") {
    return clean(h.get("x-vercel-forwarded-for")?.split(",")[0]) ?? clean(h.get("x-real-ip"));
  }
  const hops = trustedProxyHops(env);
  if (hops === 0) return null;
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length < hops) return null;
  return clean(chain[chain.length - hops]);
}

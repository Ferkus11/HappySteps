import { describe, expect, it } from "vitest";
import { clientIp, trustedProxyHops } from "@/lib/client-ip";

const h = (headers: Record<string, string>) => ({ get: (n: string) => headers[n.toLowerCase()] ?? null });

describe("clientIp (rate-limit key)", () => {
  it("takes the entry appended by the trusted proxy, not the spoofable first one", () => {
    const env = {};
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), env)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }), env)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7" }), env)).toBe("203.0.113.7");
  });

  it("honours TRUSTED_PROXY_HOPS", () => {
    const env = { TRUSTED_PROXY_HOPS: "2" };
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }), env)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "10.0.0.2" }), env)).toBeNull(); // shorter than the proxy chain
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7" }), { TRUSTED_PROXY_HOPS: "0" })).toBeNull();
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "abc" })).toBe(1);
  });

  it("on Vercel uses the headers Vercel overwrites and ignores x-forwarded-for", () => {
    const env = { VERCEL: "1" };
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }), env)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "203.0.113.8", "x-forwarded-for": "6.6.6.6" }), env)).toBe("203.0.113.8");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6" }), env)).toBeNull();
  });

  it("no header or garbage → null", () => {
    expect(clientIp(h({}), {})).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, not-an-ip" }), {})).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "::1" }), {})).toBe("::1");
  });
});

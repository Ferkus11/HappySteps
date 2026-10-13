import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isIos, isIosSafari, isStandalone, shouldOfferIosInstall } from "@/lib/pwa/detect";
import { isNetworkError } from "@/lib/pwa/network-error";
import { CONTEXT_KEY, USER_CACHE_PREFIX, contextChanged, isSignedOutPath } from "@/lib/pwa/caches";
import manifest from "@/app/manifest";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("iOS / standalone detection", () => {
  it("recognises iPhone and iPadOS (Mac UA with touch), not Mac or Android", () => {
    expect(isIos({ userAgent: UA.iphoneSafari })).toBe(true);
    expect(isIos({ userAgent: UA.iphoneChrome })).toBe(true);
    expect(isIos({ userAgent: UA.ipadOs, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: UA.android, maxTouchPoints: 5 })).toBe(false);
  });

  it("tells Safari from other iOS browsers", () => {
    expect(isIosSafari({ userAgent: UA.iphoneSafari })).toBe(true);
    expect(isIosSafari({ userAgent: UA.iphoneChrome })).toBe(false);
    expect(isIosSafari({ userAgent: UA.ipadOs, maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: UA.android })).toBe(false);
  });

  it("standalone = navigator.standalone or display-mode", () => {
    expect(isStandalone({ userAgent: UA.iphoneSafari, iosStandalone: true })).toBe(true);
    expect(isStandalone({ userAgent: UA.android, displayModeStandalone: true })).toBe(true);
    expect(isStandalone({ userAgent: UA.iphoneSafari, iosStandalone: false, displayModeStandalone: false })).toBe(false);
    expect(isStandalone({ userAgent: UA.iphoneSafari })).toBe(false);
  });

  it("offers the Home Screen steps only on iOS, in the browser, until dismissed", () => {
    const iphone = { userAgent: UA.iphoneSafari, iosStandalone: false };
    expect(shouldOfferIosInstall(iphone, false)).toBe(true);
    expect(shouldOfferIosInstall(iphone, true)).toBe(false);
    expect(shouldOfferIosInstall({ ...iphone, iosStandalone: true }, false)).toBe(false);
    expect(shouldOfferIosInstall({ userAgent: UA.android }, false)).toBe(false);
  });
});

describe("network errors", () => {
  it("matches the browsers' fetch failures only", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
    expect(isNetworkError("Failed to fetch")).toBe(false);
  });
});

interface SwRules {
  VERSION: string;
  STATIC_CACHE: string;
  SHELL_CACHE: string;
  PAGES_CACHE: string;
  USER_CACHE_PREFIX: string;
  OFFLINE_URL: string;
  isStaticAsset(url: URL, origin: string): boolean;
  isCacheablePage(url: URL, origin: string): boolean;
  pageCacheKey(href: string): string;
  isCacheablePageResponse(res: unknown): boolean;
  extractStaticAssets(html: string): string[];
  isOwnCache(name: string): boolean;
}

/** Evaluates public/sw.js with a stub `self` and returns the rules it exposes. */
function loadSw() {
  const src = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
  const imported: string[] = [];
  const events: string[] = [];
  const self: Record<string, unknown> = {
    addEventListener: (type: string) => events.push(type),
    location: { origin: "https://app.test" },
  };
  new Function("self", "importScripts", src)(self, (u: string) => imported.push(u));
  return { rules: self.hsSwRules as SwRules, imported, events };
}

const res = (init: { status?: number; redirected?: boolean; type?: string; ct?: string }) => ({
  status: init.status ?? 200,
  redirected: init.redirected ?? false,
  type: init.type ?? "basic",
  headers: new Headers({ "content-type": init.ct ?? "text/html; charset=utf-8" }),
});

describe("service worker cache rules", () => {
  const { rules, imported, events } = loadSw();
  const O = "https://app.test";
  const u = (p: string, origin = O) => new URL(p, origin);

  it("loads the push handlers first and listens to the lifecycle", () => {
    expect(imported[0]).toBe("/sw-push.js");
    expect(events).toEqual(expect.arrayContaining(["install", "activate", "fetch", "message"]));
  });

  it("uses versioned cache names; the personal cache prefix matches the app", () => {
    for (const n of [rules.STATIC_CACHE, rules.SHELL_CACHE, rules.PAGES_CACHE]) expect(n.endsWith(`-${rules.VERSION}`)).toBe(true);
    expect(rules.PAGES_CACHE.startsWith(USER_CACHE_PREFIX)).toBe(true);
    expect(rules.USER_CACHE_PREFIX).toBe(USER_CACHE_PREFIX);
    expect(rules.STATIC_CACHE.startsWith(USER_CACHE_PREFIX)).toBe(false);
    expect(rules.isOwnCache("hs-static-v0")).toBe(true);
    expect(rules.isOwnCache("other-lib")).toBe(false);
  });

  it("static assets: only same-origin build files and icons", () => {
    expect(rules.isStaticAsset(u("/_next/static/chunks/app-1a2b.js"), O)).toBe(true);
    expect(rules.isStaticAsset(u("/icons/icon-192.png"), O)).toBe(true);
    expect(rules.isStaticAsset(u("/_next/image?url=x"), O)).toBe(false);
    expect(rules.isStaticAsset(u("/_next/static/x.js", "https://cdn.other"), O)).toBe(false);
  });

  it("pages: app screens yes; auth, gates, API, exports, other origins no", () => {
    for (const p of ["/", "/payments", "/children/123", "/chats/abc?x=1"]) expect(rules.isCacheablePage(u(p), O)).toBe(true);
    for (const p of ["/login", "/invite/tok", "/api/health", "/offline", "/consent", "/blocked", "/no-access", "/apply/kg", "/worktime/export", "/_next/data"])
      expect(rules.isCacheablePage(u(p), O)).toBe(false);
    expect(rules.isCacheablePage(u("/payments", "https://xyz.supabase.co"), O)).toBe(false);
    // prefixes are whole path segments
    expect(rules.isCacheablePage(u("/apply-rules"), O)).toBe(true);
  });

  it("page cache key ignores hash, RSC param and parameter order", () => {
    expect(rules.pageCacheKey(`${O}/payments?b=2&a=1#top`)).toBe(`${O}/payments?a=1&b=2`);
    expect(rules.pageCacheKey(`${O}/payments?_rsc=abc`)).toBe(`${O}/payments`);
    expect(rules.pageCacheKey(`${O}/`)).toBe(`${O}/`);
  });

  it("stores only a 200 HTML page that was not redirected", () => {
    expect(rules.isCacheablePageResponse(res({}))).toBe(true);
    expect(rules.isCacheablePageResponse(res({ redirected: true }))).toBe(false);
    expect(rules.isCacheablePageResponse(res({ status: 500 }))).toBe(false);
    expect(rules.isCacheablePageResponse(res({ type: "opaqueredirect", status: 0 }))).toBe(false);
    expect(rules.isCacheablePageResponse(res({ ct: "application/pdf" }))).toBe(false);
    expect(rules.isCacheablePageResponse(null)).toBe(false);
  });

  it("finds the static files of the offline page", () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/a1.css"/><script src="/_next/static/chunks/b2.js" async></script>
      <script>self.__next_f.push([1,"\\"/_next/static/chunks/c3.js\\""])</script><img src="/icons/x.png">`;
    expect(rules.extractStaticAssets(html).sort()).toEqual(["/_next/static/chunks/b2.js", "/_next/static/chunks/c3.js", "/_next/static/css/a1.css"]);
  });
});

describe("signed-out screens clear personal pages", () => {
  it("login, invite, no access and blocked garden", () => {
    expect(isSignedOutPath("/login")).toBe(true);
    expect(isSignedOutPath("/invite/abc")).toBe(true);
    expect(isSignedOutPath("/no-access")).toBe(true);
    expect(isSignedOutPath("/blocked")).toBe(true);
    expect(isSignedOutPath("/")).toBe(false);
    expect(isSignedOutPath("/loginx")).toBe(false);
    expect(isSignedOutPath("/notifications")).toBe(false);
  });
});

describe("a change of user / garden / role clears personal pages", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("reports a change once and remembers the new context", () => {
    const s = memory();
    expect(contextChanged("u1|kgA:parent", s)).toBe(true); // first visit on this device: nothing known, clear
    expect(s.m.get(CONTEXT_KEY)).toBe("u1|kgA:parent");
    expect(contextChanged("u1|kgA:parent", s)).toBe(false);
    expect(contextChanged("u1|kgB:parent", s)).toBe(true); // a push click switched the garden
    expect(contextChanged("u1|kgB:teacher", s)).toBe(true); // role
    expect(contextChanged("u2|kgB:teacher", s)).toBe(true); // another account
    expect(contextChanged("u2|kgB:teacher", s)).toBe(false);
  });
  it("outside the app or without storage nothing happens", () => {
    expect(contextChanged("", memory())).toBe(false);
    expect(contextChanged("u1|x", null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(contextChanged("u1|x", broken)).toBe(false);
  });
});

describe("web app manifest", () => {
  const m = manifest();
  it("is installable: name, standalone, start_url, colours", () => {
    expect(m.name).toBe("Happy Steps");
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("icons exist with the declared sizes (192/512, any + maskable)", () => {
    const icons = m.icons ?? [];
    for (const size of ["192x192", "512x512"])
      for (const purpose of ["any", "maskable"]) expect(icons.some((i) => i.sizes === size && i.purpose === purpose)).toBe(true);
    for (const i of [...icons, { src: "/icons/apple-touch-icon.png", sizes: "180x180" }]) {
      const png = readFileSync(resolve(__dirname, "../../public", i.src.slice(1)));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(i.sizes);
    }
  });
});

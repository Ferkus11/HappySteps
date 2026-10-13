"use client";

/**
 * Browser side of Web Push. The service worker is the PWA's `/sw.js` (it imports `/sw-push.js`); until one is
 * registered, `/sw-push.js` itself is registered so push works on its own. Subscriptions belong to the
 * registration of scope `/`, so they survive when the PWA worker replaces it.
 */

export type PushState = "loading" | "unsupported" | "ios" | "blocked" | "on" | "off";

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The existing registration for `/` (never registers one). */
export async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = (await existingRegistration()) ?? (await navigator.serviceWorker.register("/sw-push.js", { scope: "/" }));
  if (reg.active) return reg;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 15_000)),
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await existingRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** State of this device for the profile card. */
export async function detectPushState(publicKey: string | null): Promise<PushState> {
  if (!pushSupported() || !publicKey) return isIos() && !isStandalone() ? "ios" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string | null;
}

export function toInput(sub: PushSubscription): SubscriptionInput {
  const json = sub.toJSON();
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, userAgent: navigator.userAgent.slice(0, 500) };
}

/** Must run from a user gesture (iOS and Safari require it for the permission prompt). */
export async function subscribePush(publicKey: string): Promise<"blocked" | "off" | SubscriptionInput> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const reg = await readyRegistration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  return toInput(sub);
}

/** Unsubscribes this browser; returns the endpoint that was removed (for the server). */
export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}

/**
 * Logout on a possibly shared device: unsubscribes this browser so the next person on it never sees the previous
 * user's pushes, and returns the endpoint so the server can delete its row. Never throws and never holds the
 * logout for long (`timeoutMs`).
 */
export async function releaseDevicePush(timeoutMs = 3000): Promise<string | null> {
  if (!pushSupported()) return null;
  let endpoint: string | null = null;
  const work = (async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
  return endpoint;
}

/** sessionStorage marker of PushSync: «this tab already re-saved the subscription for this user». */
const SYNC_PREFIX = "hs_push_synced";

export function pushSyncKey(userId: string): string {
  return `${SYNC_PREFIX}:${userId}`;
}

/** Forgets every sync marker of this tab (logout, context switch): the next user's shell syncs again. */
export function clearPushSyncMarkers(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SYNC_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // storage blocked: there is no marker either
  }
}

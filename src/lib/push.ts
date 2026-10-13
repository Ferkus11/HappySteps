import "server-only";
import webpush from "web-push";
import type { Locale } from "@/i18n/config";
import { createServiceClient } from "@/lib/supabase/service";
import { renderNotification, type NotificationMessages, type NotificationParams } from "@/lib/notification-render";
import ruMessages from "@/messages/ru/notifications.json";
import kkMessages from "@/messages/kk/notifications.json";

/**
 * Web Push delivery (SPEC §5.12). Encryption and VAPID signing come from `web-push`; the HTTP request itself
 * is sent with `fetch` (no redirects, 10 s timeout) to an allow-listed push service only.
 * Nothing here throws into the caller — a failed push never breaks the action that caused it.
 */

const MESSAGES: Record<Locale, NotificationMessages> = { ru: ruMessages, kk: kkMessages };
/** How long a push service keeps an undelivered message (the bell keeps the notification anyway). */
export const PUSH_TTL_SECONDS = 24 * 3600;
/** A deferred push older than this is dropped (e.g. the cron was down) — it would only be noise. */
const STALE_MS = 24 * 3600 * 1000;

/** Push services of the browsers we support (Chrome/Edge/Opera/Samsung via FCM, Firefox, Safari, Windows). */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function vapid(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { subject: process.env.VAPID_SUBJECT || "mailto:support@happysteps.kz", publicKey, privateKey };
}

/**
 * Only real push services may receive our requests (an endpoint is user input — no SSRF). The local stack
 * (`PUSH_ALLOW_LOCAL_ENDPOINTS=1`, written by scripts/local-supabase/write-env.mjs) also allows loopback
 * endpoints so the e2e test can stand in for a push service without the internet.
 */
export function isAllowedEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === "https:" && !u.port && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return true;
  return process.env.PUSH_ALLOW_LOCAL_ENDPOINTS === "1" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}

export interface PushRow {
  id: string;
  user_id: string;
  kindergarten_id: string | null;
  type: string;
  params: NotificationParams | null;
  url: string | null;
}

export interface PushPayload {
  id: string;
  title: string;
  body: string;
  /** Opens through /notifications/<id>/open: marks the row read, switches to its garden, then goes to `url`. */
  url: string;
  /** Collapses notifications of one chat into one on the device. */
  tag: string;
}

/** The chat id of a `/chats/<uuid>` link (for collapsing a chat's pushes), else null. */
export function chatIdOf(url: string | null): string | null {
  const m = /^\/chats\/([0-9a-f-]{36})(?:$|[?#])/i.exec(url ?? "");
  return m ? m[1].toLowerCase() : null;
}

/** Payload and push-service options for one notification in the recipient's language. */
export function buildPush(row: PushRow, locale: Locale): { payload: PushPayload; urgency: webpush.Urgency; topic?: string } {
  const { title, body } = renderNotification(MESSAGES[locale] ?? MESSAGES.ru, locale, row.type, row.params);
  const chat = chatIdOf(row.url);
  return {
    payload: {
      id: row.id,
      title,
      body: body.length > 300 ? `${body.slice(0, 299)}…` : body,
      url: `/notifications/${row.id}/open`,
      tag: chat ? `chat:${chat}` : `n:${row.id}`,
    },
    urgency: row.type === "message.new" || row.type === "absence.reported" ? "high" : "normal",
    // Push services keep only the newest pending message per topic (≤ 32 URL-safe characters).
    topic: chat ? chat.replace(/-/g, "") : undefined,
  };
}

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** Sends one push; returns "gone" when the subscription no longer exists at the push service. */
async function sendOne(sub: Subscription, push: ReturnType<typeof buildPush>, keys: NonNullable<ReturnType<typeof vapid>>): Promise<"ok" | "gone" | "failed"> {
  if (!isAllowedEndpoint(sub.endpoint)) return "gone";
  try {
    const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(push.payload), {
      vapidDetails: keys,
      TTL: PUSH_TTL_SECONDS,
      urgency: push.urgency,
      topic: push.topic,
      contentEncoding: "aes128gcm",
    });
    const res = await fetch(req.endpoint, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.body ? new Uint8Array(req.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      console.error("push failed", res.status, new URL(sub.endpoint).host);
      return "failed";
    }
    return "ok";
  } catch (e) {
    console.error("push error", new URL(sub.endpoint).host, e instanceof Error ? e.message : e);
    return "failed";
  }
}

/** Sends the given (already claimed) notifications to every device of their recipients. Never throws. */
export async function sendPushes(rows: PushRow[]): Promise<{ sent: number; removed: number }> {
  const keys = vapid();
  if (!keys || !rows.length) return { sent: 0, removed: 0 };
  try {
    const db = createServiceClient();
    const users = [...new Set(rows.map((r) => r.user_id))];
    const [{ data: subs }, { data: profiles }] = await Promise.all([
      db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", users),
      db.from("profiles").select("id, locale").in("id", users),
    ]);
    if (!subs?.length) return { sent: 0, removed: 0 };
    const locale = new Map((profiles ?? []).map((p) => [p.id as string, (p.locale === "kk" ? "kk" : "ru") as Locale]));
    const byUser = new Map<string, Subscription[]>();
    for (const s of subs as Subscription[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

    const gone = new Set<string>();
    const used = new Set<string>();
    await Promise.all(
      rows.flatMap((row) => {
        const push = buildPush(row, locale.get(row.user_id) ?? "ru");
        return (byUser.get(row.user_id) ?? []).map(async (s) => {
          const r = await sendOne(s, push, keys);
          if (r === "gone") gone.add(s.id);
          if (r === "ok") used.add(s.id);
        });
      }),
    );
    if (gone.size) await db.from("push_subscriptions").delete().in("id", [...gone]);
    if (used.size) await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", [...used]);
    return { sent: used.size, removed: gone.size };
  } catch (e) {
    console.error("push delivery failed", e instanceof Error ? e.message : e);
    return { sent: 0, removed: 0 };
  }
}

const ROW_COLUMNS = "id, user_id, kindergarten_id, type, params, url, read_at";

/**
 * Immediate delivery for freshly inserted rows: claims them (`pushed_at`, only if still unclaimed — the
 * deferred cron and this path can never both send a row) and sends.
 */
export async function deliverNow(ids: string[]): Promise<void> {
  if (!ids.length || !vapid()) return;
  try {
    const { data } = await createServiceClient()
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", ids)
      .is("pushed_at", null)
      .select(ROW_COLUMNS);
    await sendPushes((data ?? []) as PushRow[]);
  } catch (e) {
    console.error("push deliverNow failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Cron: sends pushes whose quiet-hours deferral has passed. Rows are claimed atomically in SQL
 * (`claim_deferred_pushes`), so overlapping runs never send twice. Rows read in the meantime or older
 * than a day are claimed but not sent.
 */
export async function deliverDeferred(now = new Date()): Promise<{ claimed: number; sent: number; removed: number }> {
  const db = createServiceClient();
  let claimed = 0;
  let sent = 0;
  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await db.rpc("claim_deferred_pushes", { p_limit: 500 });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (PushRow & { read_at: string | null; deliver_after: string })[];
    claimed += rows.length;
    const due = rows.filter((r) => !r.read_at && now.getTime() - new Date(r.deliver_after).getTime() < STALE_MS);
    const r = await sendPushes(due);
    sent += r.sent;
    removed += r.removed;
    if (rows.length < 500) break;
  }
  return { claimed, sent, removed };
}

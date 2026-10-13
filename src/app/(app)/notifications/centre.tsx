"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BadgeCheck,
  Bell,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  Clock,
  FileWarning,
  FileX,
  ListPlus,
  Megaphone,
  MessageCircle,
  Palette,
  Receipt,
  Settings2,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { addDays, formatDate, formatTime, todayIn } from "@/lib/format";
import { renderNotification, type NotificationMessages } from "@/lib/notification-render";
import type { Locale } from "@/i18n/config";
import type { NotificationItem } from "@/lib/notifications-data";
import { subscribeAuthed, uniqueTopic } from "@/components/chats/realtime";
import { NOTIFICATIONS_CHANGED } from "@/components/notifications/live-bell";
import { isOnline } from "@/lib/pwa/connectivity";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";
import { safeAppPath } from "@/lib/safe-path";
import { loadNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

const ICONS: Record<string, LucideIcon> = {
  "message.new": MessageCircle,
  "announcement.new": Megaphone,
  "announcement.reminder": Megaphone,
  "event.reminder": CalendarDays,
  "absence.reported": UserX,
  "attendance.not_marked": ClipboardCheck,
  "receipt.new": Receipt,
  "receipt.accepted": BadgeCheck,
  "receipt.rejected": FileX,
  "club.request": Palette,
  "club.spot_free": Palette,
  "club.decision": Palette,
  "waitlist.new": ListPlus,
  "document.expiring": FileWarning,
  "worktime.auto_closed": Clock,
};

const changed = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

/** A chat message notification whose message was deleted (params.deleted = "yes", set by delete_chat_message). */
export function isDeletedMessage(i: Pick<NotificationItem, "type" | "params">) {
  return i.type === "message.new" && i.params?.deleted === "yes";
}

function dayKey(iso: string, tz: string) {
  return todayIn(tz, new Date(iso));
}

export function NotificationCentre(props: { items: NotificationItem[]; more: boolean; unread: number; elsewhere: number; timeZone: string }) {
  const t = useTranslations("notifications");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const messages = (useMessages() as unknown as { notifications: NotificationMessages }).notifications;
  const router = useRouter();
  const { blocked, failed } = useOfflineGuard();
  const [items, setItems] = React.useState(props.items);
  const [more, setMore] = React.useState(props.more);
  const [loading, setLoading] = React.useState(false);
  const [markingAll, setMarkingAll] = React.useState(false);
  const sentinel = React.useRef<HTMLDivElement>(null);
  // Unread rows beyond the loaded pages count too (server number, kept in step with local changes).
  const [serverUnread, setServerUnread] = React.useState(props.unread);
  const unread = Math.max(serverUnread, items.filter((i) => !i.read_at).length);

  const loadMore = React.useCallback(async () => {
    if (loading || !more || !items.length || !isOnline()) return;
    setLoading(true);
    const last = items[items.length - 1];
    const r = await loadNotificationsAction({ createdAt: last.created_at, id: last.id }).catch((e: unknown) => (failed(e), null));
    setLoading(false);
    if (!r?.ok) return;
    setItems((cur) => {
      const seen = new Set(cur.map((i) => i.id));
      return [...cur, ...r.data.items.filter((i) => !seen.has(i.id))];
    });
    setMore(r.data.more);
  }, [items, loading, more, failed]);

  // Infinite scroll; the button stays as a fallback.
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, more]);

  // Live: new rows appear on top, rows read elsewhere (another tab, a push click) lose the highlight.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchNewest = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        // Offline the saved page stays as it is; the channel re-fetches once it reconnects.
        if (!isOnline()) return;
        const r = await loadNotificationsAction(null).catch(() => null);
        if (!r?.ok) return;
        setItems((cur) => {
          const byId = new Map(r.data.items.map((i) => [i.id, i]));
          const seen = new Set(cur.map((i) => i.id));
          const fresh = r.data.items.filter((i) => !seen.has(i.id));
          return [...fresh, ...cur.map((i) => byId.get(i.id) ?? i)];
        });
      }, 300);
    };
    const unsubscribe = subscribeAuthed(
      (supabase) =>
        supabase
          .channel(uniqueTopic("notifications-centre"))
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, fetchNewest)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, fetchNewest),
      fetchNewest,
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const open = async (item: NotificationItem) => {
    // Offline: the link still opens (a saved page may exist), the row stays unread until the next visit.
    if (!item.read_at && isOnline()) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
      setServerUnread((n) => Math.max(0, n - 1));
      await markNotificationReadAction(item.id).catch((e: unknown) => failed(e));
      changed();
    }
    const path = safeAppPath(item.url);
    if (path) router.push(path);
  };

  const readAll = async () => {
    if (blocked()) return;
    setMarkingAll(true);
    let r: Awaited<ReturnType<typeof markAllNotificationsReadAction>> | null = null;
    try {
      r = await markAllNotificationsReadAction();
    } catch (e) {
      if (failed(e)) return;
    } finally {
      setMarkingAll(false);
    }
    if (!r?.ok) {
      toast.error(te("generic"));
      return;
    }
    const now = new Date().toISOString();
    setItems((cur) => cur.map((i) => (i.read_at ? i : { ...i, read_at: now })));
    setServerUnread(0);
    changed();
    toast.success(t("allRead"));
  };

  const today = todayIn(props.timeZone);
  const yesterday = addDays(today, -1);
  const groups: { key: string; items: NotificationItem[] }[] = [];
  // A chat message deleted after its notification arrived is noise («Сообщение удалено»): the server leaves such
  // rows out and a row that turns deleted while the page is open (live update) disappears here too.
  for (const item of items.filter((i) => !isDeletedMessage(i))) {
    const key = dayKey(item.created_at, props.timeZone);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  const label = (key: string) => (key === today ? t("today") : key === yesterday ? t("yesterday") : formatDate(key));

  return (
    // one column: the header actions line up with the list instead of the far right edge at 1440
    <div className="max-w-3xl">
      <PageHeader
        title={t("title")}
        actions={
          <>
            <Button asChild variant="ghost" size="md">
              <Link href="/profile#notifications" data-testid="notifications-settings">
                <Settings2 aria-hidden />
                {t("settings")}
              </Link>
            </Button>
            {unread > 0 ? (
              // secondary: reading everything is housekeeping, not the main action of the screen (SPEC §8)
              <Button variant="secondary" onClick={readAll} disabled={markingAll} data-testid="notifications-read-all">
                <CheckCheck aria-hidden />
                {t("markAllRead")}
              </Button>
            ) : null}
          </>
        }
      />
      {props.elsewhere > 0 ? (
        <p className="mb-4 rounded-2xl bg-sky-soft px-4 py-3 text-sm text-sky-strong" data-testid="notifications-elsewhere">
          {t("otherGardens", { count: props.elsewhere })}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={Bell} title={t("empty")} hint={t("emptyHint")} />
        </Card>
      ) : (
        <div className="space-y-5" data-testid="notification-list">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`day-${g.key}`}>
              <h2 id={`day-${g.key}`} className="mb-2 px-1 text-[13px] font-bold tracking-wide text-faint uppercase">
                {label(g.key)}
              </h2>
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-border/70">
                  {g.items.map((item) => {
                    const { title, body } = renderNotification(messages, locale, item.type, item.params);
                    const Icon = ICONS[item.type] ?? Bell;
                    const isUnread = !item.read_at;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => void open(item)}
                          data-testid="notification"
                          data-unread={isUnread ? "true" : "false"}
                          className={cn(
                            "flex min-h-16 w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted md:px-5",
                            isUnread && "bg-brand-soft/60",
                          )}
                        >
                          <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full", isUnread ? "bg-surface text-brand" : "bg-surface-muted text-muted")}>
                            <Icon className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className={cn("min-w-0 text-[15px] text-text", isUnread ? "font-bold" : "font-semibold")}>{title}</span>
                              <span className="shrink-0 text-xs text-faint tabular-nums">{formatTime(item.created_at, props.timeZone)}</span>
                            </span>
                            {body ? <span className="mt-0.5 line-clamp-2 block text-sm break-words text-muted">{body}</span> : null}
                          </span>
                          {isUnread ? (
                            <span className="mt-2 size-2.5 shrink-0 rounded-full bg-brand" aria-label={t("unread")} role="img" />
                          ) : (
                            <span className="size-2.5 shrink-0" aria-hidden />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          <div ref={sentinel} />
          {more ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loading} data-testid="notifications-more">
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
          {loading ? <Skeleton className="h-16 w-full" /> : null}
        </div>
      )}
    </div>
  );
}

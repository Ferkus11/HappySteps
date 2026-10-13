"use client";

import * as React from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { subscribeAuthed, uniqueTopic } from "./realtime";
import { localDay, sortChats, type ChatSummary } from "@/lib/chats-logic";
import { formatTime } from "@/lib/format";
import { chatListAction } from "@/app/(app)/chats/actions";
import { NewChatDialog } from "./new-chat-dialog";

interface ChatsCtx {
  /** The open conversation marked itself read — clear its badge locally. */
  markedRead: (chatId: string) => void;
  unreadOf: (chatId: string) => number;
}
const Ctx = React.createContext<ChatsCtx | null>(null);
export const useChatsFrame = () => React.useContext(Ctx);

/** Two panes on desktop (list + conversation); on phones the list, or the open chat full screen. */
export function ChatsFrame({
  initial,
  userId,
  timezone,
  children,
}: {
  initial: ChatSummary[];
  userId: string;
  timezone: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("chats");
  const active = useSelectedLayoutSegment();
  const activeId = active && /^[0-9a-f-]{36}$/.test(active) ? active : null;
  const [rows, setRows] = React.useState(initial);
  const activeRef = React.useRef(activeId);
  React.useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  // A server re-render (router.refresh) brings fresh rows.
  const [seen, setSeen] = React.useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial);
  }

  // Live list: any change of a message in my chats (RLS limits delivery to them) → reload the summaries.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const res = await chatListAction().catch(() => null);
        if (!res?.ok) return;
        const open = activeRef.current;
        const visible = document.visibilityState === "visible";
        setRows(
          res.data.map((r) =>
            r.id === open && visible ? { ...r, unread: 0 } : r,
          ),
        );
      }, 250);
    };
    const unsubscribe = subscribeAuthed((supabase) =>
      supabase
        .channel(uniqueTopic(`chat-list-${userId}`))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          reload,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages" },
          reload,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chats" },
          reload,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_reads",
            filter: `user_id=eq.${userId}`,
          },
          reload,
        ),
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [userId]);

  const ctx = React.useMemo<ChatsCtx>(
    () => ({
      markedRead: (id) =>
        setRows((s) => s.map((r) => (r.id === id ? { ...r, unread: 0 } : r))),
      unreadOf: (id) => rows.find((r) => r.id === id)?.unread ?? 0,
    }),
    [rows],
  );

  const sorted = sortChats(rows);
  const today = localDay(new Date().toISOString(), timezone);

  return (
    <Ctx.Provider value={ctx}>
      <div className="md:grid md:h-[calc(100dvh-8.75rem)] md:min-h-[520px] md:grid-cols-[340px_minmax(0,1fr)] md:gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section
          className={cn(
            "min-h-0 flex-col md:flex",
            activeId ? "hidden" : "flex",
          )}
          aria-label={t("title")}
        >
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-3">
            <h1 className="text-[22px] font-extrabold tracking-tight text-text md:text-[24px]">
              {t("title")}
            </h1>
            <NewChatDialog />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-border/70 bg-surface shadow-card">
            {sorted.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title={t("emptyList")}
                hint={t("emptyListHint")}
              />
            ) : (
              <ul className="divide-y divide-border/70" data-testid="chat-list">
                {sorted.map((c) => (
                  <li key={c.id}>
                    <ChatListItem
                      chat={c}
                      active={c.id === activeId}
                      userId={userId}
                      timezone={timezone}
                      today={today}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <div
          className={cn("min-h-0 min-w-0", activeId ? "" : "hidden md:block")}
        >
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function ChatAvatar({
  kind,
  name,
  color,
  size = 48,
}: {
  kind: ChatSummary["kind"];
  name: string;
  color?: string | null;
  size?: number;
}) {
  if (kind === "direct") return <Avatar name={name} size={size} />;
  const Icon = kind === "group" ? Users : Briefcase;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background:
          kind === "group"
            ? `color-mix(in oklab, ${color ?? "#4FA3E0"} 18%, white)`
            : "var(--sky-soft)",
        color:
          kind === "group"
            ? `color-mix(in oklab, ${color ?? "#4FA3E0"} 80%, black)`
            : "var(--sky-strong)",
      }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} />
    </span>
  );
}

export function useChatTitle() {
  const t = useTranslations("chats");
  return (c: Pick<ChatSummary, "kind" | "group_name" | "other_name">) =>
    c.kind === "group"
      ? (c.group_name ?? t("groupChat"))
      : c.kind === "staff"
        ? t("staffChat")
        : (c.other_name ?? t("unknownPerson"));
}

function ChatListItem({
  chat: c,
  active,
  userId,
  timezone,
  today,
}: {
  chat: ChatSummary;
  active: boolean;
  userId: string;
  timezone: string;
  today: string;
}) {
  const t = useTranslations("chats");
  const tr = useTranslations("roles");
  const title = useChatTitle()(c);
  // Group and person names are user content (not translated); the staff chat title is a translation.
  const userTitle = c.kind === "group" ? !!c.group_name : c.kind === "direct" ? !!c.other_name : false;
  const subtitle =
    c.kind === "group"
      ? t("groupChat")
      : c.kind === "staff"
        ? t("staffChatHint")
        : c.other_role
          ? tr(c.other_role)
          : null;
  const mine = c.last_author_id === userId;
  const who =
    c.last_id && !c.last_deleted
      ? mine
        ? t("you")
        : c.kind !== "direct"
          ? c.last_author_name?.split(" ").slice(0, 2).reverse().join(" ")
          : null
      : null;
  let preview: React.ReactNode = (
    <span className="text-faint">{t("noMessages")}</span>
  );
  if (c.last_id) {
    if (c.last_deleted)
      preview = <span className="italic">{t("deletedShort")}</span>;
    else if (c.last_body) preview = <span data-user-content>{c.last_body}</span>;
    else if (c.last_file)
      preview = (
        <span className="inline-flex items-center gap-1">
          {c.last_file === "photo" ? (
            <ImageIcon className="size-3.5" aria-hidden />
          ) : (
            <FileText className="size-3.5" aria-hidden />
          )}
          {c.last_file === "photo" ? t("photo") : t("file")}
        </span>
      );
  }
  const when = c.last_at
    ? localDay(c.last_at, timezone) === today
      ? formatTime(c.last_at, timezone)
      : formatDayShort(c.last_at, timezone)
    : "";
  return (
    <Link
      href={`/chats/${c.id}`}
      aria-current={active ? "page" : undefined}
      data-testid={`chat-item-${c.kind}`}
      data-chat-id={c.id}
      className={cn(
        "flex min-h-[76px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted",
        active && "bg-brand-soft hover:bg-brand-soft",
      )}
    >
      <ChatAvatar kind={c.kind} name={title} color={c.group_color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[15px] font-bold text-text"
            data-testid="chat-title"
            data-user-content={userTitle ? "" : undefined}
          >
            {title}
          </span>
          <span className="shrink-0 text-xs text-faint">{when}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {who ? (
              <span className="font-semibold text-text/80" data-user-content={mine ? undefined : ""}>{who}: </span>
            ) : null}
            {preview}
          </span>
          {c.unread > 0 ? (
            <span
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-fg"
              data-testid="chat-unread"
              aria-label={t("unread", { count: c.unread })}
            >
              {c.unread > 99 ? "99+" : c.unread}
            </span>
          ) : null}
        </div>
        {subtitle && c.kind !== "direct" ? (
          <span className="sr-only">{subtitle}</span>
        ) : null}
        {c.kind === "direct" && subtitle ? (
          <div className="mt-0.5 truncate text-[12px] text-faint">
            {subtitle}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function formatDayShort(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

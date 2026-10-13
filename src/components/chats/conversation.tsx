"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  FileText,
  Lock,
  MoreVertical,
  Pencil,
  Reply,
  RotateCcw,
  Trash2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import {
  deletedKind,
  localDay,
  mergeMessages,
  withinEditWindow,
  type ChatFile,
  type ChatKind,
  type ChatMessage,
  type ChatPerson,
} from "@/lib/chats-logic";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import {
  deleteMessageAction,
  editMessageAction,
  markChatReadAction,
  latestMessagesAction,
  messagesByIdAction,
  olderMessagesAction,
  participantsAction,
  sendMessageAction,
  setParentsCanWriteAction,
} from "@/app/(app)/chats/actions";
import { ChatAvatar, useChatsFrame } from "./chats-frame";
import { Composer, type Draft } from "./composer";
import { subscribeAuthed, uniqueTopic } from "./realtime";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

export interface ConversationProps {
  chat: {
    id: string;
    kind: ChatKind;
    title: string;
    subtitle: string | null;
    color: string | null;
  };
  me: string;
  timezone: string;
  initialMessages: ChatMessage[];
  quotes: ChatMessage[];
  hasMore: boolean;
  participants: ChatPerson[];
  otherReadAt: string | null;
  staffSide: boolean;
  parentsCanWrite: boolean;
  canWrite: boolean;
  moderator: boolean;
  quiet: boolean;
}

type Change = RealtimePostgresChangesPayload<Record<string, unknown>>;
type Local = {
  pending?: boolean;
  failed?: Draft;
  localFile?: { name: string; kind: "photo" | "pdf" };
};

export function Conversation(p: ConversationProps) {
  const t = useTranslations("chats");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const offline = useOfflineGuard();
  const router = useRouter();
  const frame = useChatsFrame();
  const chatId = p.chat.id;
  const [messages, setMessages] = React.useState<ChatMessage[]>(
    p.initialMessages,
  );
  const [quotes, setQuotes] = React.useState<Record<string, ChatMessage>>(() =>
    Object.fromEntries(p.quotes.map((q) => [q.id, q])),
  );
  const [local, setLocal] = React.useState<Record<string, Local>>({});
  const [people, setPeople] = React.useState<Record<string, ChatPerson>>(() =>
    Object.fromEntries(p.participants.map((x) => [x.user_id, x])),
  );
  const [otherReadAt, setOtherReadAt] = React.useState(p.otherReadAt);
  const [parentsCanWrite, setParentsCanWrite] = React.useState(
    p.parentsCanWrite,
  );
  const [hasMore, setHasMore] = React.useState(p.hasMore);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null);
  const [editing, setEditing] = React.useState<ChatMessage | null>(null);
  const [toDelete, setToDelete] = React.useState<ChatMessage | null>(null);
  const [now] = React.useState(() => new Date());
  // Edits are allowed for 15 minutes after sending: re-check the window every 30 s.
  const [clock, setClock] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const peopleRef = React.useRef(people);
  React.useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  // Group chats follow the live "только сотрудники пишут" switch; other chats use the server's answer.
  const canWrite =
    p.chat.kind === "group" ? p.staffSide || parentsCanWrite : p.canWrite;

  // Server re-renders (router.refresh) bring a fresh page — merge, never drop what we already have.
  const [seen, setSeen] = React.useState({
    messages: p.initialMessages,
    parentsCanWrite: p.parentsCanWrite,
  });
  if (
    seen.messages !== p.initialMessages ||
    seen.parentsCanWrite !== p.parentsCanWrite
  ) {
    setSeen({
      messages: p.initialMessages,
      parentsCanWrite: p.parentsCanWrite,
    });
    setMessages((s) => mergeMessages(s, p.initialMessages));
    setParentsCanWrite(p.parentsCanWrite);
  }

  const byId = React.useMemo(
    () => Object.fromEntries(messages.map((m) => [m.id, m])),
    [messages],
  );

  // ── read marker ──
  const readTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const markRead = React.useCallback(() => {
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(async () => {
      readTimer.current = undefined;
      if (document.visibilityState !== "visible") return;
      const had = frame?.unreadOf(chatId) ?? 0;
      frame?.markedRead(chatId);
      const r = await markChatReadAction(chatId).catch(() => null);
      if (r?.ok && had > 0) router.refresh(); // header badge
    }, 400);
  }, [chatId, frame, router]);
  React.useEffect(() => {
    markRead();
    const onVis = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      // leaving the chat before the debounce fired: still record that it was read
      if (readTimer.current) {
        clearTimeout(readTimer.current);
        void markChatReadAction(chatId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // ── realtime ──
  const [live, setLive] = React.useState(false);
  React.useEffect(() => {
    const fetchMissing = async (ids: string[]) => {
      const r = await messagesByIdAction(ids).catch(() => null);
      if (r?.ok)
        setMessages((s) =>
          mergeMessages(
            s,
            r.data.filter((m) => m.chat_id === chatId),
          ),
        );
    };
    const ensurePerson = async (uid: string | null) => {
      if (!uid || peopleRef.current[uid]) return;
      const r = await participantsAction(chatId).catch(() => null);
      if (r?.ok)
        setPeople(Object.fromEntries(r.data.map((x) => [x.user_id, x])));
    };
    return subscribeAuthed((supabase) =>
      supabase
        .channel(uniqueTopic(`chat-${chatId}`))
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (e: Change) => {
            const m = {
              ...(e.new as Omit<ChatMessage, "files">),
              files: [] as ChatFile[],
            };
            setMessages((s) =>
              s.some((x) => x.id === m.id) ? s : mergeMessages(s, [m]),
            );
            void ensurePerson(m.author_id);
            if (m.reply_to) void fetchMissing([m.reply_to]);
            if (m.author_id !== p.me) markRead();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (e: Change) => {
            const m = e.new as Omit<ChatMessage, "files">;
            setMessages((s) =>
              s.map((x) =>
                x.id === m.id
                  ? { ...x, ...m, files: m.deleted_at ? [] : x.files }
                  : x,
              ),
            );
            setQuotes((q) =>
              q[m.id] ? { ...q, [m.id]: { ...q[m.id], ...m } } : q,
            );
          },
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "message_files",
            filter: `chat_id=eq.${chatId}`,
          },
          (e: Change) => {
            const f = e.new as ChatFile & { chat_id: string };
            let found = false;
            setMessages((s) =>
              s.map((x) => {
                if (x.id !== f.message_id) return x;
                found = true;
                return x.files.some((y) => y.id === f.id)
                  ? x
                  : {
                      ...x,
                      files: [
                        ...x.files,
                        {
                          id: f.id,
                          message_id: f.message_id,
                          kind: f.kind,
                          name: f.name,
                          size: f.size,
                          mime: f.mime,
                        },
                      ],
                    };
              }),
            );
            if (!found) void fetchMissing([f.message_id]);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_reads",
            filter: `chat_id=eq.${chatId}`,
          },
          (e: Change) => {
            const r = e.new as { user_id?: string; last_read_at?: string };
            if (r.user_id && r.user_id !== p.me && r.last_read_at)
              setOtherReadAt(r.last_read_at);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chats",
            filter: `id=eq.${chatId}`,
          },
          (e: Change) => {
            const c = e.new as { parents_can_write?: boolean };
            if (typeof c.parents_can_write === "boolean")
              setParentsCanWrite(c.parents_can_write);
          },
        ),
      // Joined (or re-joined after a drop): pick up whatever was written while the channel was not live.
      async () => {
        const r = await latestMessagesAction(chatId).catch(() => null);
        if (r?.ok) {
          setMessages((s) => mergeMessages(s, r.data.messages));
          setQuotes((q) => ({ ...q, ...Object.fromEntries(r.data.quotes.map((x) => [x.id, x])) }));
          for (const m of r.data.messages) void ensurePerson(m.author_id);
        }
        setLive(true);
      },
    );
  }, [chatId, p.me, markRead]);

  // ── scrolling: stay at the bottom unless the reader scrolled up ──
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, local]);
  // Photos load after the first paint: keep the bottom in view while the content grows.
  const listRef = React.useRef<HTMLOListElement>(null);
  const hasList = messages.length > 0;
  React.useEffect(() => {
    const el = scroller.current;
    const list = listRef.current;
    if (!el || !list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [hasList]);
  const onScroll = () => {
    const el = scroller.current;
    if (el)
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const before = el ? el.scrollHeight : 0;
    try {
      const r = await olderMessagesAction(chatId, first.created_at);
      if (!r.ok)
        return toast.error(te.has(r.error) ? te(r.error) : te("generic"));
      stick.current = false;
      setMessages((s) => mergeMessages(r.data.messages, s));
      setQuotes((q) => ({
        ...q,
        ...Object.fromEntries(r.data.quotes.map((x) => [x.id, x])),
      }));
      setHasMore(r.data.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  // ── sending ──
  async function send(d: Draft, retryId?: string) {
    if (offline.blocked()) return false;
    if (editing) {
      const r = await editMessageAction(editing.id, d.body).catch((e) => {
        if (!offline.failed(e)) throw e;
        return null;
      });
      if (!r) return false;
      if (!r.ok) {
        toast.error(te.has(r.error) ? te(r.error) : te("generic"));
        return false;
      }
      setMessages((s) =>
        mergeMessages(s, [
          {
            ...r.data,
            files: s.find((x) => x.id === r.data.id)?.files ?? r.data.files,
          },
        ]),
      );
      setEditing(null);
      return true;
    }
    const id = retryId ?? crypto.randomUUID();
    const optimistic: ChatMessage = {
      id,
      chat_id: chatId,
      author_id: p.me,
      body: d.body.trim(),
      reply_to: d.replyTo?.id ?? null,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
      files: [],
    };
    stick.current = true;
    setMessages((s) => (retryId ? s : mergeMessages(s, [optimistic])));
    setLocal((l) => ({
      ...l,
      [id]: {
        pending: true,
        localFile: d.file
          ? {
              name: d.file.name,
              kind: d.file.type === "application/pdf" ? "pdf" : "photo",
            }
          : undefined,
      },
    }));
    setReplyTo(null);
    const fd = new FormData();
    fd.set("chatId", chatId);
    fd.set("id", id);
    fd.set("body", d.body);
    if (d.replyTo) fd.set("replyTo", d.replyTo.id);
    if (d.file) fd.set("file", d.file);
    let networkFailed = false;
    const r = await sendMessageAction(fd).catch((e) => {
      networkFailed = offline.failed(e);
      return null;
    });
    if (r?.ok) {
      setMessages((s) => mergeMessages(s, [r.data]));
      setLocal((l) => {
        const { [id]: _, ...rest } = l;
        return rest;
      });
      return true;
    }
    if (!networkFailed) toast.error(r && !r.ok && te.has(r.error) ? te(r.error) : te("generic"));
    setLocal((l) => ({
      ...l,
      [id]: { failed: d, localFile: l[id]?.localFile },
    }));
    return true; // the draft lives on in the failed bubble («Повторить»)
  }

  async function confirmDelete() {
    const m = toDelete;
    if (!m || offline.blocked()) return;
    const r = await deleteMessageAction(m.id).catch((e) => {
      if (!offline.failed(e)) throw e;
      return null;
    });
    if (!r) return;
    if (!r.ok)
      return toast.error(te.has(r.error) ? te(r.error) : te("generic"));
    setMessages((s) =>
      s.map((x) =>
        x.id === m.id
          ? {
              ...x,
              body: "",
              files: [],
              deleted_at: new Date().toISOString(),
              deleted_by: p.me,
            }
          : x,
      ),
    );
    setToDelete(null);
  }

  const name = (uid: string | null) =>
    (uid && people[uid]?.full_name) || t("unknownPerson");
  const today = localDay(now.toISOString(), p.timezone);
  const yesterday = localDay(
    new Date(now.getTime() - 864e5).toISOString(),
    p.timezone,
  );
  const dayLabel = (d: string, iso: string) =>
    d === today
      ? t("today")
      : d === yesterday
        ? t("yesterday")
        : formatDate(iso, p.timezone);

  const items: React.ReactNode[] = [];
  let prev: ChatMessage | null = null;
  for (const m of messages) {
    const day = localDay(m.created_at, p.timezone);
    const newDay = !prev || localDay(prev.created_at, p.timezone) !== day;
    if (newDay)
      items.push(
        <li
          key={`d-${day}`}
          className="my-3 flex justify-center"
          data-testid="day-separator"
        >
          <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-sm">
            {dayLabel(day, m.created_at)}
          </span>
        </li>,
      );
    const grouped =
      !newDay &&
      prev &&
      prev.author_id === m.author_id &&
      Date.parse(m.created_at) - Date.parse(prev.created_at) < 10 * 60_000;
    items.push(
      <Bubble
        key={m.id}
        m={m}
        mine={m.author_id === p.me}
        showAuthor={
          p.chat.kind !== "direct" && !grouped && m.author_id !== p.me
        }
        author={name(m.author_id)}
        role={m.author_id ? (people[m.author_id]?.chat_role ?? null) : null}
        quote={
          m.reply_to ? (byId[m.reply_to] ?? quotes[m.reply_to] ?? null) : null
        }
        quoteAuthor={(q) =>
          q.author_id === p.me ? t("you") : name(q.author_id)
        }
        local={local[m.id]}
        timezone={p.timezone}
        readTick={
          p.chat.kind === "direct" && m.author_id === p.me
            ? local[m.id]?.pending
              ? "pending"
              : otherReadAt &&
                  Date.parse(otherReadAt) >= Date.parse(m.created_at)
                ? "read"
                : "sent"
            : null
        }
        canReply={canWrite}
        canEdit={
          m.author_id === p.me &&
          canWrite &&
          !local[m.id] &&
          withinEditWindow(m.created_at, clock)
        }
        canDelete={
          !local[m.id] &&
          (m.author_id === p.me || (p.moderator && p.chat.kind === "group"))
        }
        onReply={() => {
          setEditing(null);
          setReplyTo(m);
        }}
        onEdit={() => {
          setReplyTo(null);
          setEditing(m);
        }}
        onDelete={() => setToDelete(m)}
        onRetry={() => {
          const f = local[m.id]?.failed;
          if (f) void send(f, m.id);
        }}
      />,
    );
    prev = m;
  }

  const memberCount = Object.values(people).filter((x) => x.is_member).length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg md:static md:z-auto md:h-full md:overflow-hidden md:rounded-card md:border md:border-border/70 md:bg-surface md:shadow-card"
      data-testid="conversation"
      data-live={live ? "true" : undefined}
    >
      <header className="flex min-h-16 items-center gap-2 border-b border-border/70 bg-surface px-2 py-2 md:px-4">
        <Link
          href="/chats"
          className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-muted md:hidden"
          aria-label={t("back")}
          data-testid="chat-back"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <ChatAvatar
          kind={p.chat.kind}
          name={p.chat.title}
          color={p.chat.color}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <h1 data-user-content
            className="truncate text-[16px] font-extrabold text-text"
            data-testid="chat-heading"
          >
            {p.chat.title}
          </h1>
          <p className="truncate text-[12px] text-muted">
            {p.chat.kind === "direct"
              ? p.chat.subtitle
              : t("members", { count: memberCount })}
            {p.chat.kind === "group" && !parentsCanWrite
              ? ` · ${t("staffOnlyShort")}`
              : ""}
          </p>
        </div>
        {p.moderator && p.chat.kind === "group" ? (
          <ModerationMenu
            chatId={chatId}
            parentsCanWrite={parentsCanWrite}
            onChange={setParentsCanWrite}
          />
        ) : null}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-bg px-3 py-3 md:px-5"
        data-testid="messages"
      >
        {hasMore ? (
          <div className="mb-2 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadOlder}
              disabled={loadingOlder}
              data-testid="load-older"
            >
              <ChevronDown className="rotate-180" /> {t("loadOlder")}
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={t("emptyChat")}
            hint={canWrite ? t("emptyChatHint") : undefined}
          />
        ) : (
          <ol ref={listRef} className="mx-auto max-w-3xl space-y-1">{items}</ol>
        )}
      </div>

      {canWrite ? (
        <Composer
          key={editing?.id ?? "new"}
          replyTo={replyTo}
          replyAuthor={
            replyTo
              ? replyTo.author_id === p.me
                ? t("you")
                : name(replyTo.author_id)
              : ""
          }
          editing={editing}
          quietHint={p.quiet && !p.staffSide && p.chat.kind !== "staff"}
          onCancel={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          onSend={(d) => send(d)}
        />
      ) : (
        <div
          className="pb-safe flex items-center gap-2 border-t border-border/70 bg-surface px-4 py-4 text-sm text-muted"
          data-testid="composer-locked"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          {p.chat.kind === "group" && !parentsCanWrite
            ? t("readOnlyParents")
            : t("readOnly")}
        </div>
      )}

      <Dialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        {toDelete ? (
          <DialogContent
            title={t("deleteTitle")}
            description={
              toDelete.author_id === p.me
                ? t("deleteOwnHint")
                : t("deleteModerationHint")
            }
          >
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setToDelete(null)}>
                {tc("cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                data-testid="confirm-delete-message"
              >
                <Trash2 /> {t("delete")}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function ModerationMenu({
  chatId,
  parentsCanWrite,
  onChange,
}: {
  chatId: string;
  parentsCanWrite: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("chats");
  const te = useTranslations("errors");
  const offline = useOfflineGuard();
  const [busy, setBusy] = React.useState(false);
  async function toggle(staffOnly: boolean) {
    if (offline.blocked()) return;
    setBusy(true);
    try {
      const r = await setParentsCanWriteAction(chatId, !staffOnly).catch((e) => {
        if (!offline.failed(e)) throw e;
        return null;
      });
      if (!r) return;
      if (!r.ok)
        return toast.error(te.has(r.error) ? te(r.error) : te("generic"));
      onChange(!staffOnly);
      toast.success(staffOnly ? t("lockedToast") : t("unlockedToast"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("chatSettings")}
          data-testid="chat-settings"
        >
          <MoreVertical />
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-72">
        <DropdownItem
          onSelect={() => {
            if (!busy) void toggle(parentsCanWrite);
          }}
          data-testid="toggle-staff-only"
        >
          <ShieldCheck />
          <span className="flex-1">
            <span className="block font-semibold">{t("staffOnly")}</span>
            <span className="block text-xs text-muted">
              {t("staffOnlyHint")}
            </span>
          </span>
          <Switch
            checked={!parentsCanWrite}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none"
          />
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function Bubble({
  m,
  mine,
  showAuthor,
  author,
  role,
  quote,
  quoteAuthor,
  local,
  timezone,
  readTick,
  canReply,
  canEdit,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  onRetry,
}: {
  m: ChatMessage;
  mine: boolean;
  showAuthor: boolean;
  author: string;
  role: string | null;
  quote: ChatMessage | null;
  quoteAuthor: (q: ChatMessage) => string;
  local?: Local;
  timezone: string;
  readTick: "pending" | "sent" | "read" | null;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("chats");
  const tr = useTranslations("roles");
  const fmt = useFormatter();
  const fileSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? fmt.number(bytes / 1024 / 1024, {
          style: "unit",
          unit: "megabyte",
          unitDisplay: "short",
          maximumFractionDigits: 1,
        })
      : fmt.number(Math.max(1, Math.round(bytes / 1024)), {
          style: "unit",
          unit: "kilobyte",
          unitDisplay: "short",
        });
  const del = deletedKind(m);
  const menu = del === "none" && !local && (canReply || canEdit || canDelete);
  const staffRole = role && role !== "parent" ? tr(role) : null;
  return (
    <li
      id={`m-${m.id}`}
      className={cn(
        "group flex",
        mine ? "justify-end" : "justify-start",
        showAuthor && "mt-3",
      )}
      data-testid="message"
      data-mine={mine || undefined}
    >
      <div
        className={cn(
          "relative max-w-[85%] md:max-w-[70%]",
          mine ? "items-end" : "items-start",
        )}
      >
        {showAuthor ? (
          <div className="mb-0.5 px-3 text-[12px] font-bold text-sky-strong">
            {author}
            {staffRole ? (
              <span className="ml-1.5 font-semibold text-faint">
                · {staffRole}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2 text-[15px] leading-snug shadow-sm",
            mine
              ? "rounded-br-md bg-brand-soft text-text"
              : "rounded-bl-md bg-surface text-text",
            del !== "none" && "bg-surface-muted text-muted shadow-none",
            local?.failed && "ring-1 ring-danger/40",
          )}
        >
          {del !== "none" ? (
            <p className="italic" data-testid="message-deleted">
              {del === "admin" ? t("deletedByAdmin") : t("deleted")}
            </p>
          ) : (
            <>
              {quote ? (
                <a
                  href={`#m-${quote.id}`}
                  className="mb-1.5 block rounded-lg border-l-[3px] border-sky bg-sky-soft/60 px-2.5 py-1 text-[13px]"
                  data-testid="reply-quote"
                >
                  <span className="block font-bold text-sky-strong">
                    {quoteAuthor(quote)}
                  </span>
                  <span className="line-clamp-2 text-muted">
                    {quote.deleted_at
                      ? t("deletedShort")
                      : quote.body ||
                        (quote.files[0]?.kind === "pdf"
                          ? t("file")
                          : t("photo"))}
                  </span>
                </a>
              ) : null}
              {m.files.map((f) =>
                f.kind === "photo" ? (
                  <a
                    key={f.id}
                    href={`/chats/file/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-1.5 block"
                    data-testid="message-photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- served through a short-lived signed URL */}
                    <img
                      src={`/chats/file/${f.id}`}
                      alt={f.name}
                      className="max-h-72 w-auto max-w-full rounded-xl bg-surface-muted object-contain"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <a
                    key={f.id}
                    href={`/chats/file/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-1.5 flex min-h-12 items-center gap-2.5 rounded-xl bg-surface/70 px-3 py-2 hover:bg-surface"
                    data-testid="message-file"
                  >
                    <FileText
                      className="size-5 shrink-0 text-sky-strong"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span data-user-content className="block truncate text-sm font-semibold">
                        {f.name}
                      </span>
                      <span className="block text-xs text-faint">
                        PDF · {fileSize(f.size)}
                      </span>
                    </span>
                  </a>
                ),
              )}
              {local?.localFile && !m.files.length ? (
                <div className="mb-1.5 flex min-h-12 items-center gap-2.5 rounded-xl bg-surface/70 px-3 py-2 text-sm text-muted">
                  <FileText className="size-5 shrink-0" aria-hidden />
                  <span data-user-content className="truncate">{local.localFile.name}</span>
                </div>
              ) : null}
              {m.body ? (
                <p data-user-content
                  className="break-words whitespace-pre-wrap"
                  data-testid="message-text"
                >
                  {m.body}
                </p>
              ) : null}
            </>
          )}
          <div
            className={cn(
              "mt-0.5 flex items-center justify-end gap-1 text-[11px] text-faint",
              menu && "pr-6",
            )}
          >
            {m.edited_at && del === "none" ? <span>{t("edited")}</span> : null}
            <time dateTime={m.created_at}>
              {formatTime(m.created_at, timezone)}
            </time>
            {readTick === "pending" ? (
              <Clock className="size-3.5" aria-label={t("sending")} />
            ) : null}
            {readTick === "sent" ? (
              <span data-testid="read-tick" data-read="false" title={t("sent")}>
                <Check className="size-3.5" aria-hidden />
                <span className="sr-only">{t("sent")}</span>
              </span>
            ) : null}
            {readTick === "read" ? (
              <span
                data-testid="read-tick"
                data-read="true"
                title={t("read")}
                className="inline-flex items-center gap-0.5 text-sky-strong"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                <span className="sr-only">{t("read")}</span>
              </span>
            ) : null}
          </div>
          {menu ? (
            <Dropdown>
              <DropdownTrigger asChild>
                {/* 44px hit area around a small visual circle */}
                <button
                  type="button"
                  className="group/menu absolute -right-1 -bottom-1 grid size-11 cursor-pointer place-items-center rounded-full text-faint opacity-60 group-hover:opacity-100 hover:text-text pointer-coarse:opacity-100"
                  aria-label={t("messageActions")}
                  data-testid="message-menu"
                >
                  <span className="grid size-7 place-items-center rounded-full group-hover/menu:bg-surface-muted">
                    <ChevronDown className="size-4" />
                  </span>
                </button>
              </DropdownTrigger>
              <DropdownContent align={mine ? "end" : "start"}>
                {canReply ? (
                  <DropdownItem onSelect={onReply} data-testid="message-reply">
                    <Reply /> {t("reply")}
                  </DropdownItem>
                ) : null}
                {canEdit && m.body ? (
                  <DropdownItem onSelect={onEdit} data-testid="message-edit">
                    <Pencil /> {t("edit")}
                  </DropdownItem>
                ) : null}
                {canDelete ? (
                  <DropdownItem
                    onSelect={onDelete}
                    className="text-danger [&_svg]:text-danger"
                    data-testid="message-delete"
                  >
                    <Trash2 /> {mine ? t("delete") : t("deleteModeration")}
                  </DropdownItem>
                ) : null}
              </DropdownContent>
            </Dropdown>
          ) : null}
        </div>
        {local?.failed ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-1 px-2 text-xs font-semibold text-danger"
            data-testid="message-retry"
          >
            <RotateCcw className="size-3.5" aria-hidden /> {t("notSent")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

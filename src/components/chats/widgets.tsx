import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { loadChatList } from "@/lib/chats";
import { formatTime, formatDate } from "@/lib/format";
import { localDay, type ChatSummary } from "@/lib/chats-logic";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

async function Preview({ c, ctx }: { c: ChatSummary; ctx: KgContext }) {
  const t = await getTranslations("chats");
  if (!c.last_id) return <span className="text-faint">{t("noMessages")}</span>;
  const tz = ctx.settings.timezone;
  const when = c.last_at ? (localDay(c.last_at, tz) === localDay(new Date().toISOString(), tz) ? formatTime(c.last_at, tz) : formatDate(c.last_at, tz).slice(0, 5)) : "";
  const text = c.last_deleted ? t("deletedShort") : c.last_body || (c.last_file === "pdf" ? t("file") : t("photo"));
  const who = c.last_author_id === ctx.userId ? t("you") : c.last_author_name?.split(" ").slice(0, 2).reverse().join(" ");
  return (
    <span className="block min-w-0">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-text/80">{who}</span>
        <span className="shrink-0 text-xs text-faint">{when}</span>
      </span>
      <span className={c.last_deleted ? "block truncate italic" : "block truncate"}>{text}</span>
    </span>
  );
}

/** Teacher: «Чат группы» — unread count and the last message of each own group chat. */
async function GroupChatWidget({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const chats = (await loadChatList(supabase, ctx)).filter(
    (c) => c.kind === "group",
  );
  if (!chats.length) return null;
  const t = await getTranslations("chats");
  return (
    <Card data-testid="widget-group-chat">
      <CardHeader
        title={t("widgetGroup")}
        href={chats.length === 1 ? `/chats/${chats[0].id}` : "/chats"}
      />
      <ul className="space-y-3">
        {chats.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chats/${c.id}`}
              className="flex items-center gap-4 rounded-2xl bg-surface-muted px-4 py-3 hover:bg-sky-soft"
            >
              <div className="text-center">
                <div
                  className={
                    c.unread
                      ? "text-[30px] leading-none font-extrabold text-brand"
                      : "text-[30px] leading-none font-extrabold text-text"
                  }
                  data-testid="widget-unread"
                >
                  {c.unread}
                </div>
                <div className="mt-1 text-[11px] font-medium text-muted">
                  {t("unreadCaption", { count: c.unread })}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-text">
                  {c.group_name}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  <Preview c={c} ctx={ctx} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Club teacher: «Чаты» — total unread and the most recent conversations. */
async function ChatsWidget({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const chats = await loadChatList(supabase, ctx);
  const t = await getTranslations("chats");
  const total = chats.reduce((s, c) => s + c.unread, 0);
  const recent = chats
    .filter((c) => c.last_at)
    .sort((a, b) => Date.parse(b.last_at!) - Date.parse(a.last_at!))
    .slice(0, 3);
  return (
    <Card data-testid="widget-chats">
      <CardHeader title={t("title")} href="/chats" />
      <div className="mb-3 flex items-baseline gap-2">
        <span
          className="text-[30px] leading-none font-extrabold text-text"
          data-testid="widget-unread"
        >
          {total}
        </span>
        <span className="text-[13px] font-medium text-muted">
          {t("unreadCaption", { count: total })}
        </span>
      </div>
      {recent.length ? (
        <ul className="divide-y divide-border/70">
          {recent.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chats/${c.id}`}
                className="block min-h-12 py-2.5 hover:text-brand"
              >
                <div className="flex items-center gap-2 text-[14px] font-bold text-text">
                  <span className="truncate">
                    {c.kind === "group"
                      ? c.group_name
                      : c.kind === "staff"
                        ? t("staffChat")
                        : c.other_name}
                  </span>
                  {c.unread ? (
                    <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-fg">
                      {c.unread}
                    </span>
                  ) : null}
                </div>
                <div className="text-[13px] text-muted">
                  <Preview c={c} ctx={ctx} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={MessageCircle}
          title={t("emptyList")}
          className="py-4"
        />
      )}
    </Card>
  );
}

export const chatsWidgets: DashboardWidget[] = [
  {
    id: "chat-group",
    roles: ["teacher"],
    slot: "main",
    order: 15,
    Component: GroupChatWidget,
  },
  {
    id: "chats",
    roles: ["club_teacher"],
    slot: "main",
    order: 15,
    Component: ChatsWidget,
  },
];

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, MessageCircle, MoreHorizontal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, type NavItem } from "@/lib/nav";
import { navIcons } from "./nav-icons";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { AccountMenu, type ContextOption } from "./account-menu";
import { LanguageSwitcher } from "./language-switcher";
import { OfflineBanner } from "./offline-banner";
import { useLiveUnreadChats } from "@/components/chats/live-unread";
import { useLiveUnreadNotifications } from "@/components/notifications/live-bell";
import { PushSync } from "@/components/notifications/push-sync";

export interface ShellProps {
  nav: { all: NavItem[]; mobile: NavItem[]; more: NavItem[] };
  kindergarten: { name: string; logoUrl?: string | null } | null;
  user: { fullName: string; phone: string };
  roleLabel: string;
  contexts: ContextOption[];
  currentContext: string | null;
  /** Signed-in user (push sync marker, the personal-data context PwaRoot watches). */
  userId?: string;
  unreadChats?: number;
  unreadNotifications?: number;
  showSearch?: boolean;
  children: React.ReactNode;
}

function Logo({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-9 rounded-xl object-cover" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-[15px] font-extrabold text-brand-fg">
          {name.slice(0, 1)}
        </span>
      )}
      <span className="truncate text-[17px] font-extrabold tracking-tight text-text">{name}</span>
    </Link>
  );
}

function CountDot({ n, testId }: { n?: number; testId?: string }) {
  if (!n) return null;
  return (
    <span
      data-testid={testId}
      className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-fg"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function AppShell(props: ShellProps) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const unreadChats = useLiveUnreadChats(props.unreadChats, props.nav.all.some((i) => i.key === "chats"));
  const unreadNotifications = useLiveUnreadNotifications(props.unreadNotifications);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const kgName = props.kindergarten?.name ?? tc("appName");

  return (
    <div
      className="min-h-dvh md:grid md:grid-cols-[260px_1fr]"
      // Whose data this page shows (user + garden + role): PwaRoot drops saved pages when it changes.
      data-hs-context={props.userId ? `${props.userId}|${props.currentContext ?? ""}` : undefined}
    >
      {/* Desktop sidebar: the grid column carries the white background and border down the whole page
          (it stretches with the content); the menu inside stays sticky at viewport height. */}
      <div className="hidden border-r border-border bg-surface md:block" data-testid="sidebar-column">
        <aside className="sticky top-0 flex h-dvh flex-col" aria-label={t("mainNavigation")}>
          <div className="px-5 pt-5 pb-4">
            <Logo name={kgName} logoUrl={props.kindergarten?.logoUrl} />
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
            {props.nav.all.map((item) => {
              const Icon = navIcons[item.key];
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition-colors",
                    active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-muted hover:text-text",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
        </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border/70 bg-surface/90 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-4 md:px-8">
            <div className="min-w-0 flex-1 md:hidden">
              <Logo name={kgName} logoUrl={props.kindergarten?.logoUrl} />
            </div>
            {props.showSearch !== false ? (
              <form action="/search" className="hidden max-w-md flex-1 md:block" role="search">
                <label className="relative block">
                  <span className="sr-only">{tc("search")}</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <input
                    name="q"
                    placeholder={tc("searchPlaceholder")}
                    className="h-11 w-full rounded-xl border border-border bg-surface-muted pr-3 pl-10 text-sm placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none"
                  />
                </label>
              </form>
            ) : (
              <div className="hidden flex-1 md:block" />
            )}
            <div className="ml-auto flex items-center gap-1">
              <LanguageSwitcher />
              {props.nav.all.some((i) => i.key === "chats") ? (
                <Link href="/chats" className="relative hidden size-11 place-items-center rounded-full text-muted hover:bg-surface-muted md:grid" aria-label={t("chats")}>
                  <MessageCircle className="size-5" />
                  <CountDot n={unreadChats} />
                </Link>
              ) : null}
              <Link
                href="/notifications"
                className="relative grid size-11 place-items-center rounded-full text-muted hover:bg-surface-muted"
                aria-label={unreadNotifications ? tc("notificationsUnread", { count: unreadNotifications }) : tc("notifications")}
                data-testid="bell"
              >
                <Bell className="size-5" />
                <CountDot n={unreadNotifications} testId="unread-notifications" />
              </Link>
              <AccountMenu user={props.user} roleLabel={props.roleLabel} contexts={props.contexts} current={props.currentContext} />
            </div>
          </div>
        </header>

        <OfflineBanner />
        <PushSync userId={props.userId} />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-7 md:pb-12">{props.children}</main>
      </div>

      {/* Phone bottom bar */}
      <nav
        aria-label={t("mainNavigation")}
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {props.nav.mobile.map((item) => {
            const Icon = navIcons[item.key];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.key} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold", active ? "text-brand" : "text-muted")}
                >
                  <span className="relative">
                    <Icon className="size-[22px]" aria-hidden />
                    {item.key === "chats" ? <CountDot n={unreadChats} /> : null}
                  </span>
                  <span className="max-w-full truncate px-1">{t(item.key)}</span>
                </Link>
              </li>
            );
          })}
          {props.nav.more.length ? (
            <li className="flex-1">
              <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
                <DialogTrigger className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted">
                  <MoreHorizontal className="size-[22px]" aria-hidden />
                  {t("more")}
                </DialogTrigger>
                <DialogContent title={t("more")}>
                  <div className="grid grid-cols-3 gap-2">
                    {props.nav.more.map((item) => {
                      const Icon = navIcons[item.key];
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-surface-muted px-2 text-center text-[13px] font-semibold text-text"
                        >
                          <Icon className="size-6 text-brand" aria-hidden />
                          {t(item.key)}
                        </Link>
                      );
                    })}
                  </div>
                </DialogContent>
              </Dialog>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}

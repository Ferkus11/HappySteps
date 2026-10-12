"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, LogOut, Repeat, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { logoutAction, switchContextAction } from "@/lib/actions/session";

export interface ContextOption {
  value: string; // `${kindergartenId}:${role}` or "superadmin"
  kindergartenName: string;
  roleLabel: string;
}

export function AccountMenu({
  user,
  roleLabel,
  contexts,
  current,
}: {
  user: { fullName: string; phone: string };
  roleLabel: string;
  contexts: ContextOption[];
  current: string | null;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [, start] = React.useTransition();
  return (
    <Dropdown>
      <DropdownTrigger className="ml-1 flex cursor-pointer items-center gap-2.5 rounded-full p-1 pr-1 hover:bg-surface-muted md:pr-3" data-testid="account-menu">
        <Avatar name={user.fullName} size={36} />
        <span className="hidden text-left md:block">
          <span className="block max-w-40 truncate text-[13px] font-bold text-text">{user.fullName}</span>
          <span className="block text-xs text-muted">{roleLabel}</span>
        </span>
      </DropdownTrigger>
      <DropdownContent className="w-72">
        <DropdownLabel>{user.phone}</DropdownLabel>
        <DropdownItem asChild>
          <Link href="/profile">
            <UserRound /> {t("profile")}
          </Link>
        </DropdownItem>
        {contexts.length > 1 ? (
          <>
            <DropdownSeparator />
            <DropdownLabel className="flex items-center gap-1.5">
              <Repeat className="size-3.5" /> {t("switchContext")}
            </DropdownLabel>
            {contexts.map((c) => (
              <DropdownItem
                key={c.value}
                data-testid={`context-${c.value}`}
                onSelect={() =>
                  start(async () => {
                    await switchContextAction(c.value);
                    router.push("/");
                    router.refresh();
                  })
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.kindergartenName}</span>
                  <span className="block text-xs text-muted">{c.roleLabel}</span>
                </span>
                {c.value === current ? <Check className="!text-brand" /> : null}
              </DropdownItem>
            ))}
          </>
        ) : null}
        <DropdownSeparator />
        <DropdownItem data-testid="logout" onSelect={() => start(() => logoutAction())}>
          <LogOut /> {t("logout")}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

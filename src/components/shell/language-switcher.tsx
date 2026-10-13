"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { setLocaleAction } from "@/lib/actions/session";
import { locales } from "@/i18n/config";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const offline = useOfflineGuard();
  return (
    <Dropdown>
      <DropdownTrigger
        className="flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-bold text-muted uppercase hover:bg-surface-muted"
        data-testid="language-switcher"
        disabled={pending}
      >
        <Languages className="size-[18px]" aria-hidden />
        <span className="sr-only">{t("language")}: </span>
        {locale}
      </DropdownTrigger>
      <DropdownContent>
        {locales.map((l) => (
          <DropdownItem
            key={l}
            data-testid={`locale-${l}`}
            onSelect={() => {
              if (offline.blocked()) return;
              start(async () => {
                try {
                  await setLocaleAction(l);
                  router.refresh();
                } catch (e) {
                  if (!offline.failed(e)) throw e;
                }
              });
            }}
            className={l === locale ? "font-bold text-brand" : undefined}
            lang={l}
          >
            {t(`languages.${l}`)}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

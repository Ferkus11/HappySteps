"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { setLocaleAction } from "@/lib/actions/session";
import { locales } from "@/i18n/config";

export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Dropdown>
      <DropdownTrigger
        className="flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-bold text-muted uppercase hover:bg-surface-muted"
        aria-label={t("language")}
        data-testid="language-switcher"
        disabled={pending}
      >
        <Languages className="size-[18px]" aria-hidden />
        {locale}
      </DropdownTrigger>
      <DropdownContent>
        {locales.map((l) => (
          <DropdownItem
            key={l}
            data-testid={`locale-${l}`}
            onSelect={() =>
              start(async () => {
                await setLocaleAction(l);
                router.refresh();
              })
            }
            className={l === locale ? "font-bold text-brand" : undefined}
          >
            {t(`languages.${l}`)}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

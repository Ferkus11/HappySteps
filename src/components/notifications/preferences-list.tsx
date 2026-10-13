"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { setNotificationPreferenceAction } from "@/app/(app)/notifications/actions";
import type { NotificationType } from "@/lib/notification-types";

/** One switch per type the person can receive; saved at once (optimistic, reverted on error). */
export function PreferencesList({ types, disabled }: { types: NotificationType[]; disabled: string[] }) {
  const t = useTranslations("notifications.prefs");
  const labels = t.raw("types") as Record<string, string>;
  const [off, setOff] = React.useState(() => new Set(disabled));
  const save = useAction(setNotificationPreferenceAction, { refresh: false });

  const toggle = async (type: NotificationType, enabled: boolean) => {
    setOff((s) => {
      const n = new Set(s);
      if (enabled) n.delete(type);
      else n.add(type);
      return n;
    });
    const r = await save.run(type, enabled);
    if (!r?.ok) {
      setOff((s) => {
        const n = new Set(s);
        if (enabled) n.add(type);
        else n.delete(type);
        return n;
      });
    }
  };

  return (
    <ul className="divide-y divide-border/70" data-testid="notification-prefs">
      {types.map((type) => {
        const id = `pref-${type.replace(".", "-")}`;
        return (
          <li key={type}>
            <label htmlFor={id} className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-2">
              <span className="text-[15px] text-text">{labels[type]}</span>
              <Switch id={id} data-testid={id} checked={!off.has(type)} onCheckedChange={(v) => void toggle(type, v)} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

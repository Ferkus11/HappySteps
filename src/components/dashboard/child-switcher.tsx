"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Parent dashboard: one child at a time, pills to switch (SPEC §6 «свайп/переключатель»).
 * Panels are rendered on the server; only the selected one is mounted. The choice is remembered per browser.
 */
export function ChildSwitcher({ tabs, panels, label }: { tabs: { id: string; name: string; caption: string }[]; panels: React.ReactNode[]; label: string }) {
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hs_dash_child");
      const i = tabs.findIndex((t) => t.id === saved);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a per-browser choice after hydration
      if (i > 0) setActive(i);
    } catch {
      /* storage unavailable — first child */
    }
  }, [tabs]);
  const pick = (i: number) => {
    setActive(i);
    try {
      window.localStorage.setItem("hs_dash_child", tabs[i].id);
    } catch {
      /* ignore */
    }
  };
  const touch = React.useRef<number | null>(null);
  return (
    <div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={label} className="scrollbar-none -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="dash-child-switcher">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => pick(i)}
              className={cn(
                "flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold",
                i === active ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-text hover:bg-surface-muted",
              )}
              data-testid="dash-child-tab"
            >
              <span data-user-content>{t.name}</span>
              <span className="font-medium text-muted">· {t.caption}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        role={tabs.length > 1 ? "tabpanel" : undefined}
        onTouchStart={(e) => {
          touch.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (start == null || end == null || tabs.length < 2) return;
          const dx = end - start;
          if (Math.abs(dx) < 60) return;
          pick((active + (dx < 0 ? 1 : -1) + tabs.length) % tabs.length);
        }}
      >
        {panels[active]}
      </div>
    </div>
  );
}

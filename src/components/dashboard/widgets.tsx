import type { ComponentType } from "react";
import type { KgContext } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { announcementsWidgets } from "@/components/announcements/widgets";
import { eventsWidgets } from "@/components/events/widgets";

/**
 * Dashboard widgets contributed by modules (SPEC §5.13).
 * Each module exports its widgets from `components/<module>/widgets.tsx` and appends them here
 * (one line per module, to keep merges trivial). A widget is an async Server Component that
 * loads its own data with the user's client (RLS applies) and returns null when it has nothing to show.
 *
 * `slot`:
 *  - "top"   — today's main action (work-day button, "my child today"), right after the greeting
 *  - "stat"  — a small number card inside the owner/head top row (render a <Card> with <Stat>)
 *  - "main"  — regular cards in the two-column grid
 * `order`: lower first. `wide`: spans two columns on desktop.
 */
export interface DashboardWidget {
  id: string;
  roles: Role[];
  slot: "top" | "stat" | "main";
  order: number;
  wide?: boolean;
  Component: ComponentType<{ ctx: KgContext }>;
}

export const dashboardWidgets: DashboardWidget[] = [
  // ...worktimeWidgets,
  // ...attendanceWidgets,
  // ...menuWidgets,
  ...announcementsWidgets,
  ...eventsWidgets,
];

export function DashboardWidgets({ ctx, slot }: { ctx: KgContext; slot: DashboardWidget["slot"] }) {
  const list = dashboardWidgets
    .filter((w) => w.slot === slot && w.roles.includes(ctx.role))
    .sort((a, b) => a.order - b.order);
  if (!list.length) return null;
  if (slot === "stat") {
    // Rendered straight into the caller's grid.
    return list.map(({ id, Component }) => (
      <div key={id} className="min-w-0 empty:hidden" data-widget={id}>
        <Component ctx={ctx} />
      </div>
    ));
  }
  return (
    <div className={cn("grid gap-4", slot === "main" ? "mt-4 lg:grid-cols-2" : "mb-4")}>
      {list.map(({ id, wide, Component }) => (
        <div key={id} className={cn("min-w-0 empty:hidden", wide && "lg:col-span-2")} data-widget={id}>
          <Component ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

import { Suspense, type ComponentType, type CSSProperties } from "react";
import type { KgContext } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { menuWidgets } from "@/components/menu/widgets";
import { attendanceWidgets } from "@/components/attendance/widgets";
import { announcementsWidgets } from "@/components/announcements/widgets";
import { eventsWidgets } from "@/components/events/widgets";
import { worktimeWidgets } from "@/components/worktime/widgets";
import { documentsWidgets } from "@/components/documents/widgets";
import { paymentsWidgets } from "@/components/payments/widgets";
import { chatsWidgets } from "@/components/chats/widgets";
import { waitlistWidgets } from "@/components/waitlist/widgets";
import { clubsWidgets } from "@/components/clubs/widgets";
import { notificationsWidgets } from "@/components/notifications/widgets";
import { coreWidgets } from "./core-widgets";
import { WidgetSkeleton, type SkeletonKind } from "./skeletons";

/**
 * Dashboard widgets contributed by modules (SPEC §6).
 * Each module exports its widgets from `components/<module>/widgets.tsx` and appends them here
 * (one line per module, to keep merges trivial). A widget is an async Server Component that
 * loads its own data with the user's client (RLS applies) and returns null when it has nothing to show.
 * Every widget streams in its own <Suspense> boundary, so one slow card never blocks the page.
 *
 * `slot`:
 *  - "top"   — today's main action (work-day button, "my child today"), right after the greeting
 *  - "stat"  — a small number card in the owner/head top row (render a <Card> with <Stat>);
 *              `wide` = full row on phones (two small stats share a row otherwise)
 *  - "main"  — regular cards in the main grid (two columns on desktop)
 *  - "side"  — owner/head right column on desktop (announcements, waitlist, «Требует внимания»)
 * `order`: lower first. `wide`: spans two columns on desktop (main).
 * `phoneOrder`: position in the single phone column of the owner/head dashboard, where main and side
 *  widgets are interleaved (defaults: main — `order`, side — `100 + order`).
 * `skeleton`: the placeholder shown while the widget loads.
 */
export interface DashboardWidget {
  id: string;
  roles: Role[];
  slot: "top" | "stat" | "main" | "side";
  order: number;
  wide?: boolean;
  phoneOrder?: number;
  skeleton?: SkeletonKind;
  Component: ComponentType<{ ctx: KgContext }>;
}

export const dashboardWidgets: DashboardWidget[] = [
  ...coreWidgets,
  ...menuWidgets,
  ...attendanceWidgets,
  ...announcementsWidgets,
  ...eventsWidgets,
  ...worktimeWidgets,
  ...documentsWidgets,
  ...paymentsWidgets,
  ...chatsWidgets,
  ...waitlistWidgets,
  ...clubsWidgets,
  ...notificationsWidgets,
];

export function widgetsFor(role: Role, slot: DashboardWidget["slot"]): DashboardWidget[] {
  return dashboardWidgets.filter((w) => w.slot === slot && w.roles.includes(role)).sort((a, b) => a.order - b.order);
}

/** One widget in its own Suspense boundary; the wrapper hides itself when the widget renders nothing. */
export function WidgetSlot({ ctx, w, className }: { ctx: KgContext; w: DashboardWidget; className?: string }) {
  const phoneOrder = w.phoneOrder ?? (w.slot === "side" ? 100 + w.order : w.order);
  const { Component } = w;
  return (
    <div className={cn("min-w-0 empty:hidden", className)} data-widget={w.id} style={{ "--phone-order": phoneOrder } as CSSProperties}>
      <Suspense fallback={<WidgetSkeleton kind={w.skeleton ?? (w.slot === "stat" ? "stat" : "card")} />}>
        <Component ctx={ctx} />
      </Suspense>
    </div>
  );
}

/** Top and main slots for every role; the owner/head layout composes stat/main/side itself (see admin.tsx). */
export function DashboardWidgets({ ctx, slot }: { ctx: KgContext; slot: "top" | "main" }) {
  const list = widgetsFor(ctx.role, slot);
  if (!list.length) return null;
  return (
    <div className={cn("grid gap-4", slot === "main" ? "lg:grid-cols-2" : "mb-4")} data-slot={slot}>
      {list.map((w) => (
        <WidgetSlot key={w.id} ctx={ctx} w={w} className={cn(w.wide && "lg:col-span-2")} />
      ))}
    </div>
  );
}

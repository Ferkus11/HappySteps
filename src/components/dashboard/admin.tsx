import type { KgContext } from "@/lib/auth/context";
import { cn } from "@/lib/utils";
import { Greeting } from "./greeting";
import { DashboardWidgets, WidgetSlot, widgetsFor } from "./widgets";

/**
 * Owner / head (SPEC §6): top row of numbers, then work time, menu and events in the main column and
 * «Требует внимания», important announcements and the waitlist in the right column (desktop).
 * Phones get one column: main and side cards are interleaved by `phoneOrder` (the columns use
 * `display: contents` below xl, so their cards become items of one flex column).
 */
export async function AdminDashboard({ ctx }: { ctx: KgContext }) {
  const stats = widgetsFor(ctx.role, "stat");
  const main = widgetsFor(ctx.role, "main");
  const side = widgetsFor(ctx.role, "side");
  const order = "order-(--phone-order) xl:order-none";
  return (
    <div data-testid="dashboard" data-role={ctx.role}>
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <DashboardWidgets ctx={ctx} slot="top" />
      <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", stats.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")} data-testid="dash-stats">
        {stats.map((w) => (
          <WidgetSlot key={w.id} ctx={ctx} w={w} className={cn(w.wide && "col-span-2 xl:col-span-1")} />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] xl:items-start">
        <div className="contents xl:grid xl:grid-cols-2 xl:content-start xl:gap-4" data-slot="main">
          {main.map((w) => (
            <WidgetSlot key={w.id} ctx={ctx} w={w} className={cn(order, w.wide && "xl:col-span-2")} />
          ))}
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-4" data-slot="side">
          {side.map((w) => (
            <WidgetSlot key={w.id} ctx={ctx} w={w} className={order} />
          ))}
        </div>
      </div>
    </div>
  );
}

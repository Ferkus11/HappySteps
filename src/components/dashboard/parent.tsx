import type { KgContext } from "@/lib/auth/context";
import { Greeting } from "./greeting";
import { DashboardWidgets } from "./widgets";

export { myChildren } from "./children-data";

/** Parent (phone first, SPEC §6): child card on top, then menu, announcements, payment, events, clubs. */
export async function ParentDashboard({ ctx }: { ctx: KgContext }) {
  return (
    <div data-testid="dashboard" data-role="parent">
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <DashboardWidgets ctx={ctx} slot="top" />
      <DashboardWidgets ctx={ctx} slot="main" />
    </div>
  );
}

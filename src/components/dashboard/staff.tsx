import type { KgContext } from "@/lib/auth/context";
import { Greeting } from "./greeting";
import { DashboardWidgets } from "./widgets";

/** Teacher, cook, accountant, club teacher (SPEC §6): today's action on top, then the role's cards. */
export async function StaffDashboard({ ctx }: { ctx: KgContext }) {
  return (
    <div data-testid="dashboard" data-role={ctx.role}>
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <DashboardWidgets ctx={ctx} slot="top" />
      <DashboardWidgets ctx={ctx} slot="main" />
    </div>
  );
}

import type { KgContext } from "@/lib/auth/context";
import { Greeting } from "./greeting";
import { DashboardWidgets } from "./widgets";

export async function StaffDashboard({ ctx }: { ctx: KgContext }) {
  return (
    <>
      <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />
      <DashboardWidgets ctx={ctx} slot="top" />
      <DashboardWidgets ctx={ctx} slot="main" />
    </>
  );
}

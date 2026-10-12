import type { KgContext } from "@/lib/auth/context";
import { Greeting } from "./greeting";

export async function StaffDashboard({ ctx }: { ctx: KgContext }) {
  return <Greeting name={ctx.profile.full_name} timezone={ctx.settings.timezone} />;
}

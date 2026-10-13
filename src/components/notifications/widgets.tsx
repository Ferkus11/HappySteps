import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { vapidPublicKey } from "@/lib/push";
import { PushPrompt } from "./push-prompt";

/** The prompt decides on the device whether to show itself (push support, permission, dismissal). */
function PushPromptWidget({ ctx }: { ctx: KgContext }) {
  return <PushPrompt publicKey={vapidPublicKey()} role={ctx.role} />;
}

export const notificationsWidgets: DashboardWidget[] = [
  // Low priority in the top slot: after the day's main action (child card, work day, attendance).
  {
    id: "push-prompt",
    roles: ["parent", "owner", "head", "accountant", "teacher", "club_teacher", "cook"],
    slot: "top",
    order: 90,
    Component: PushPromptWidget,
  },
];

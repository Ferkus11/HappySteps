import type { ComponentType } from "react";
import { NotificationsProfileSection } from "@/components/notifications/profile-section";

/** Extra profile cards contributed by modules (notification preferences, PWA install help). */
export const profileSections: ComponentType[] = [NotificationsProfileSection];

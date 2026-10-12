import type { ComponentType } from "react";
import { HolidaysCard } from "@/components/holidays/holidays-card";

/**
 * Extra settings cards contributed by modules (e.g. holidays, public waitlist link).
 * Each entry is an async Server Component that loads its own data and checks its own access.
 */
export const settingsSections: ComponentType[] = [HolidaysCard];

import { z } from "zod";
import { zDate, zName, zOptionalDate, zOptionalText, zPhone } from "@/lib/validation";

/** Waitlist (SPEC §5.11): shared between the public form, the admin pages and the server actions. */
export const WAITLIST_STATUSES = ["new", "contacted", "accepted", "declined"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/** Statuses an admin sets by hand («Принята» only through «Принять»). */
export const MANUAL_STATUSES = ["new", "contacted", "declined"] as const;

/** «Ожидают» = new + contacted. */
export const WAITING: WaitlistStatus[] = ["new", "contacted"];

export const STATUS_TONE: Record<WaitlistStatus, "sky" | "lavender" | "success" | "neutral"> = {
  new: "sky",
  contacted: "lavender",
  accepted: "success",
  declined: "neutral",
};

export type WaitlistTab = "waiting" | "accepted" | "declined" | "all";
export const WAITLIST_TABS: WaitlistTab[] = ["waiting", "accepted", "declined", "all"];

export function statusesOf(tab: WaitlistTab): WaitlistStatus[] {
  if (tab === "waiting") return WAITING;
  if (tab === "all") return [...WAITLIST_STATUSES];
  return [tab];
}

/** A birth date: a real past date, a child of at most ~8 years (kindergarten age). */
export function birthDateOk(iso: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return false;
  const [y] = today.split("-").map(Number);
  return iso <= today && iso >= `${y - 8}${today.slice(4)}`;
}

/** The desired start date may not lie more than ~3 years ahead (also catches typos like 2062). */
export function desiredDateOk(iso: string | null, today: string): boolean {
  if (!iso) return true;
  const [y] = today.split("-").map(Number);
  return !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && iso <= `${y + 3}${today.slice(4)}`;
}

const utcToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Asia/Almaty (UTC+5)

/** Empty → «Обязательное поле» instead of the field's format error. */
const required = <S extends z.ZodType<unknown, string>>(schema: S) => z.string().trim().min(1, "required").pipe(schema);

export const applicationSchema = z.object({
  childName: required(zName),
  childBirthDate: required(zDate.refine((v) => birthDateOk(v, utcToday()), "dateInvalid")),
  parentName: required(zName),
  parentPhone: required(zPhone),
  desiredDate: zOptionalDate.refine((v) => desiredDateOk(v, utcToday()), "dateInvalid"),
  comment: zOptionalText(1000),
});
export type ApplicationInput = z.input<typeof applicationSchema>;

/** The public form adds a honeypot field: real people never see or fill it. */
export const publicApplicationSchema = applicationSchema.extend({
  website: z.string().max(500).optional(),
});

/** First name + initial of the last name, e.g. «Ахметова Д.» → for compact lists. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  return `${parts[0]} ${parts[1][0]}.`;
}

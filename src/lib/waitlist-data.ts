import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { signedUrl } from "@/lib/kg-assets";
import { serverEnv } from "@/lib/env";
import { WAITLIST_STATUSES, type WaitlistStatus } from "@/lib/waitlist";

export interface WaitlistRow {
  id: string;
  child_name: string;
  child_birth_date: string;
  parent_name: string;
  parent_phone: string;
  desired_date: string | null;
  comment: string | null;
  source: "public" | "manual";
  status: WaitlistStatus;
  child_id: string | null;
  accepted_at: string | null;
  created_at: string;
}

export const WAITLIST_COLUMNS =
  "id, child_name, child_birth_date, parent_name, parent_phone, desired_date, comment, source, status, child_id, accepted_at, created_at";

/** Link of the kindergarten's public application form. */
export function applyUrl(slug: string) {
  return `${serverEnv.appUrl}/apply/${slug}`;
}

export interface PublicGarden {
  id: string;
  name: string;
  slug: string;
  accent: string | null;
  logoUrl: string | null;
  defaultLocale: "ru" | "kk";
  phone: string | null;
  /** IANA time zone of the garden — date limits of the form are «today» there. */
  timezone: string;
}

/**
 * The garden behind /apply/<slug> — only an open one (not blocked, subscription not blocked).
 * Service role: anonymous visitors have no table access; only the public card fields leave this function.
 */
export async function publicGarden(slug: string): Promise<PublicGarden | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return null;
  const service = createServiceClient();
  const { data } = await service
    .from("kindergartens")
    .select("id, name, slug, accent_color, logo_path, kindergarten_settings(default_locale, phone, timezone)")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const { data: open } = await service.rpc("kg_is_open", { kg: data.id });
  if (open !== true) return null;
  const settings = data.kindergarten_settings as unknown as { default_locale: "ru" | "kk"; phone: string | null; timezone: string | null } | null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    accent: data.accent_color,
    logoUrl: await signedUrl("kindergarten-assets", data.logo_path, 3600),
    defaultLocale: settings?.default_locale ?? "ru",
    phone: settings?.phone ?? null,
    timezone: settings?.timezone || "Asia/Almaty",
  };
}

/** Number of applications per status (RLS: owner/head/accountant) — head-only counts, no rows are downloaded. */
export async function waitlistCounts(supabase: SupabaseClient, kgId: string): Promise<Record<WaitlistStatus, number>> {
  const counts = await Promise.all(
    WAITLIST_STATUSES.map(async (status) => {
      const { count } = await supabase
        .from("waitlist_applications")
        .select("id", { count: "exact", head: true })
        .eq("kindergarten_id", kgId)
        .eq("status", status);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<WaitlistStatus, number>;
}

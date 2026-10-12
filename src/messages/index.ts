import type { Locale } from "@/i18n/config";

/**
 * Translation namespaces. Each module owns messages/<locale>/<namespace>.json.
 * Add a namespace here once; both locales must define identical keys
 * (enforced by tests/unit/i18n.test.ts).
 */
export const namespaces = ["common", "nav", "auth", "roles", "errors", "invites", "consent", "admin", "staff", "groups", "children", "audit", "settings", "dashboard", "profile", "notifications", "holidays", "menu", "attendance", "announcements", "events", "worktime", "payments"] as const;

export type Namespace = (typeof namespaces)[number];

export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    namespaces.map(async (ns) => [ns, (await import(`./${locale}/${ns}.json`)).default] as const),
  );
  return Object.fromEntries(entries) as Record<Namespace, Record<string, unknown>>;
}

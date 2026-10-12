import type { Locale } from "@/i18n/config";

/**
 * Translation namespaces. Each module owns messages/<locale>/<namespace>.json.
 * Add a namespace here once; both locales must define identical keys
 * (enforced by tests/unit/i18n.test.ts).
 */
export const namespaces = ["common", "nav", "auth", "roles"] as const;

export type Namespace = (typeof namespaces)[number];

export async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    namespaces.map(async (ns) => [ns, (await import(`./${locale}/${ns}.json`)).default] as const),
  );
  return Object.fromEntries(entries) as Record<Namespace, Record<string, unknown>>;
}

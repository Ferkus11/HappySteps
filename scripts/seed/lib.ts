import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

export function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";

export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

/** Creates (or updates) a login with a known password. Returns the user id. */
export async function ensureUser(db: SupabaseClient, phone: string, fullName: string, password: string, extra: { birth_date?: string; locale?: string } = {}) {
  const { data: existing } = await db.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (existing) {
    await db.auth.admin.updateUserById(existing.id, { password });
    return existing.id as string;
  }
  const email = `${phone.replace(/\D/g, "")}@${EMAIL_DOMAIN}`;
  let created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, phone } });
  // A freshly started GoTrue occasionally fails its first DB query; retry a few times.
  for (let i = 0; i < 5 && created.error?.status === 500; i++) {
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, phone } });
  }
  if (created.error || !created.data.user) throw new Error(`createUser ${phone}: ${created.error?.message}`);
  const id = created.data.user.id;
  must(
    await db.from("profiles").insert({ id, full_name: fullName, phone, activated_at: new Date().toISOString(), ...extra }),
    `profile ${phone}`,
  );
  return id;
}

export async function ensureKindergarten(db: SupabaseClient, slug: string, name: string, extra: Record<string, unknown> = {}) {
  const { data: existing } = await db.from("kindergartens").select("id").eq("slug", slug).maybeSingle();
  if (existing) return existing.id as string;
  const kg = must(await db.from("kindergartens").insert({ slug, name, ...extra }).select("id").single(), `kg ${slug}`);
  must(await db.from("kindergarten_settings").insert({ kindergarten_id: kg.id }), "settings");
  must(await db.from("subscriptions").insert({ kindergarten_id: kg.id, plan: "trial", status: "trial" }), "subscription");
  return kg.id as string;
}

export async function ensureMembership(db: SupabaseClient, userId: string, kgId: string, role: string, consent = true) {
  const { data } = await db.from("memberships").select("id").eq("user_id", userId).eq("kindergarten_id", kgId).eq("role", role).maybeSingle();
  if (data) return data.id as string;
  const m = must(
    await db
      .from("memberships")
      .insert({ user_id: userId, kindergarten_id: kgId, role, consent_at: consent ? new Date().toISOString() : null })
      .select("id")
      .single(),
    `membership ${role}`,
  );
  return m.id as string;
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { CONTEXT_COOKIE } from "@/lib/auth/constants";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocaleAction(locale: Locale) {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await supabase.from("profiles").update({ locale }).eq("id", data.user.id);
  }
}

export async function switchContextAction(value: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  // Validate against the user's own active memberships (RLS-filtered).
  if (value !== "superadmin") {
    const [kgId, role] = value.split(":");
    const { data: m } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", data.user.id)
      .eq("kindergarten_id", kgId)
      .eq("role", role)
      .eq("status", "active")
      .maybeSingle();
    if (!m) return;
  }
  const store = await cookies();
  store.set(CONTEXT_COOKIE, value, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true });
  await supabase.from("profiles").update({ last_context: value }).eq("id", data.user.id);
}

/**
 * Ends the session. `endpoint` = this browser's push subscription (already unsubscribed on the device by the
 * client, see useLogout): its row is deleted first, while the user is still signed in (RLS: own rows only), so a
 * shared device stops receiving this user's pushes. A form submit passes FormData instead — ignored.
 * Never fails because of the subscription.
 */
export async function logoutAction(endpoint?: string | FormData | null) {
  const supabase = await createClient();
  if (typeof endpoint === "string" && endpoint.length <= 2048 && /^https?:\/\//.test(endpoint)) {
    try {
      const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) console.error("logout: push subscription", error.message);
    } catch (e) {
      console.error("logout: push subscription", e instanceof Error ? e.message : e);
    }
  }
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(CONTEXT_COOKIE);
  redirect("/login");
}

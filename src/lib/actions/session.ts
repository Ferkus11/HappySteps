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

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(CONTEXT_COOKIE);
  redirect("/login");
}

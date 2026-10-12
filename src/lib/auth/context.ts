import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONTEXT_COOKIE } from "./constants";
import { type Role, isRole } from "./roles";
import { checkSubscription } from "@/lib/subscription";

export interface MembershipRow {
  id: string;
  kindergarten_id: string;
  role: Role;
  status: "active" | "archived";
  consent_at: string | null;
  kindergartens: { id: string; name: string; slug: string; status: "active" | "blocked"; accent_color: string | null; logo_path: string | null } | null;
}

export interface KgSettings {
  kindergarten_id: string;
  timezone: string;
  default_locale: "ru" | "kk";
  late_threshold_minutes: number;
  attendance_reminder_time: string;
  attendance_escalation_time: string;
  payment_due_day: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  meals: string[];
  address: string | null;
  phone: string | null;
  requisites: Record<string, string>;
  consent_text: string;
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  locale: "ru" | "kk";
  last_context: string | null;
  birth_date: string | null;
}

export type AppContext =
  | {
      kind: "kindergarten";
      userId: string;
      profile: Profile;
      isSuperadmin: boolean;
      role: Role;
      roles: Role[]; // all active roles in this kindergarten
      membership: MembershipRow;
      kg: NonNullable<MembershipRow["kindergartens"]>;
      settings: KgSettings;
      memberships: MembershipRow[];
      contextValue: string;
    }
  | {
      kind: "superadmin";
      userId: string;
      profile: Profile;
      isSuperadmin: true;
      memberships: MembershipRow[];
      contextValue: "superadmin";
    };

type LoadResult =
  | { state: "anonymous" }
  | { state: "no-access"; userId: string; profile: Profile | null; archived: boolean }
  | { state: "blocked"; kgName: string; ctx: AppContext }
  | { state: "ok"; ctx: AppContext };

/** Loads the signed-in user, memberships and the selected kindergarten/role. Cached per request. */
export const loadContext = cache(async (): Promise<LoadResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: "anonymous" };

  const [{ data: profile }, { data: memberships }, { data: sa }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, locale, last_context, birth_date").eq("id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("id, kindergarten_id, role, status, consent_at, kindergartens(id, name, slug, status, accent_color, logo_path)")
      .eq("user_id", user.id)
      .order("created_at"),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);

  const all = (memberships ?? []) as unknown as MembershipRow[];
  const active = all.filter((m) => m.status === "active" && m.kindergartens);
  const isSuperadmin = !!sa;
  if (!profile) return { state: "no-access", userId: user.id, profile: null, archived: false };

  const store = await cookies();
  const wanted = store.get(CONTEXT_COOKIE)?.value ?? profile.last_context ?? null;

  if (wanted === "superadmin" && isSuperadmin) {
    return { state: "ok", ctx: { kind: "superadmin", userId: user.id, profile, isSuperadmin: true, memberships: active, contextValue: "superadmin" } };
  }

  const [wantKg, wantRole] = (wanted ?? "").split(":");
  const chosen =
    active.find((m) => m.kindergarten_id === wantKg && m.role === wantRole) ??
    active.find((m) => m.kindergarten_id === wantKg) ??
    active[0];

  if (!chosen) {
    if (isSuperadmin) {
      return { state: "ok", ctx: { kind: "superadmin", userId: user.id, profile, isSuperadmin: true, memberships: active, contextValue: "superadmin" } };
    }
    return { state: "no-access", userId: user.id, profile, archived: all.some((m) => m.status === "archived") };
  }

  const { data: settings } = await supabase
    .from("kindergarten_settings")
    .select("*")
    .eq("kindergarten_id", chosen.kindergarten_id)
    .maybeSingle();

  const kg = chosen.kindergartens!;
  const ctx: AppContext = {
    kind: "kindergarten",
    userId: user.id,
    profile,
    isSuperadmin,
    role: chosen.role,
    roles: active.filter((m) => m.kindergarten_id === chosen.kindergarten_id).map((m) => m.role).filter(isRole),
    membership: chosen,
    kg,
    settings: (settings ?? defaultSettings(kg.id)) as KgSettings,
    memberships: active,
    contextValue: `${chosen.kindergarten_id}:${chosen.role}`,
  };
  const sub = await checkSubscription(kg.id, kg.status);
  if (!sub.allowed) return { state: "blocked", kgName: kg.name, ctx };
  return { state: "ok", ctx };
});

function defaultSettings(kgId: string): KgSettings {
  return {
    kindergarten_id: kgId,
    timezone: "Asia/Almaty",
    default_locale: "ru",
    late_threshold_minutes: 10,
    attendance_reminder_time: "10:00",
    attendance_escalation_time: "11:00",
    payment_due_day: 10,
    quiet_hours_start: "21:00",
    quiet_hours_end: "08:00",
    meals: ["breakfast", "second_breakfast", "lunch", "snack"],
    address: null,
    phone: null,
    requisites: {},
    consent_text: "",
  };
}

/** Any signed-in user with a usable context (superadmin or kindergarten). */
export async function requireAnyContext(): Promise<AppContext> {
  const r = await loadContext();
  if (r.state === "anonymous") redirect("/login");
  if (r.state === "no-access") redirect("/no-access");
  if (r.state === "blocked") redirect("/blocked");
  return r.ctx;
}

export type KgContext = Extract<AppContext, { kind: "kindergarten" }>;

/**
 * Kindergarten context, optionally restricted to roles (by the *selected* role).
 * UI convenience only — data access is enforced by RLS regardless.
 */
export async function requireKg(roles?: Role[]): Promise<KgContext> {
  const ctx = await requireAnyContext();
  if (ctx.kind !== "kindergarten") redirect("/admin");
  if (!ctx.membership.consent_at) redirect("/consent");
  if (roles && !roles.includes(ctx.role)) redirect("/");
  return ctx;
}

export async function requireSuperadmin() {
  const ctx = await requireAnyContext();
  if (!ctx.isSuperadmin) redirect("/");
  return ctx;
}

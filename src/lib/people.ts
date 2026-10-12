import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { serverEnv } from "@/lib/env";
import { normalizePhone, phoneToAuthEmail, whatsappLink } from "@/lib/phone";
import { ActionError } from "@/lib/actions/result";
import type { Role } from "@/lib/auth/roles";
import { audit } from "@/lib/audit";

export interface InviteLink {
  url: string;
  whatsapp: string;
  text: string;
  expiresAt: string;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Finds a person by phone or creates the auth user + profile (service role). */
export async function findOrCreateUser(fullName: string, rawPhone: string): Promise<{ userId: string; existed: boolean; activated: boolean }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new ActionError("phoneInvalid");
  const service = createServiceClient();
  const { data: existing } = await service.from("profiles").select("id, activated_at").eq("phone", phone).maybeSingle();
  if (existing) return { userId: existing.id, existed: true, activated: !!existing.activated_at };

  const { data, error } = await service.auth.admin.createUser({
    email: phoneToAuthEmail(phone, serverEnv.authEmailDomain),
    email_confirm: true,
    password: randomBytes(24).toString("base64url"),
    user_metadata: { full_name: fullName.trim(), phone },
  });
  if (error || !data.user) {
    console.error("createUser failed", error?.message);
    throw new ActionError("generic");
  }
  const { error: pErr } = await service.from("profiles").insert({ id: data.user.id, full_name: fullName.trim(), phone });
  if (pErr) {
    await service.auth.admin.deleteUser(data.user.id);
    throw new ActionError(pErr.code === "23505" ? "duplicate" : "generic");
  }
  return { userId: data.user.id, existed: false, activated: false };
}

/**
 * Adds a membership. The insert runs as the acting user so RLS enforces SPEC §3.3
 * (owner: anyone; head: teacher/club_teacher/cook/parent).
 */
export async function addMembership(
  supabase: SupabaseClient,
  kgId: string,
  userId: string,
  role: Role,
  position?: string | null,
): Promise<"created" | "reactivated" | "exists"> {
  const { data: allowed } = await supabase.rpc("can_manage_role", { kg: kgId, target: role });
  if (!allowed) throw new ActionError("forbidden");
  const service = createServiceClient();
  const { data: current } = await service
    .from("memberships")
    .select("id, status")
    .eq("user_id", userId)
    .eq("kindergarten_id", kgId)
    .eq("role", role)
    .maybeSingle();
  if (current?.status === "active") return "exists";
  if (current) {
    const { error } = await supabase
      .from("memberships")
      .update({ status: "active", archived_at: null, archived_by: null })
      .eq("id", current.id);
    if (error) throw new ActionError("forbidden");
    return "reactivated";
  }
  const { error } = await supabase
    .from("memberships")
    .insert({ user_id: userId, kindergarten_id: kgId, role, position: position ?? null });
  if (error) {
    console.error("membership insert", error.message);
    throw new ActionError(error.code === "23505" ? "duplicate" : "forbidden");
  }
  return "created";
}

/** One-time link (72h) to set a password — used for invites and admin password resets. */
export async function createInvite(opts: {
  userId: string;
  kgId: string | null;
  kind: "invite" | "reset";
  createdBy: string;
}): Promise<InviteLink> {
  const service = createServiceClient();
  // Only the newest link works.
  await service.from("invites").update({ used_at: new Date().toISOString() }).eq("user_id", opts.userId).is("used_at", null);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const { error } = await service.from("invites").insert({
    token_hash: hashToken(token),
    user_id: opts.userId,
    kindergarten_id: opts.kgId,
    kind: opts.kind,
    expires_at: expiresAt,
    created_by: opts.createdBy,
  });
  if (error) throw new ActionError("generic");

  const [{ data: profile }, kg] = await Promise.all([
    service.from("profiles").select("full_name, phone").eq("id", opts.userId).single(),
    opts.kgId
      ? service.from("kindergartens").select("name, kindergarten_settings(default_locale)").eq("id", opts.kgId).single()
      : Promise.resolve({ data: null }),
  ]);
  const kgRow = kg.data as { name: string; kindergarten_settings: { default_locale: "ru" | "kk" } | null } | null;
  const locale = kgRow?.kindergarten_settings?.default_locale ?? "ru";
  const t = await getTranslations({ locale, namespace: "invites" });
  const url = `${serverEnv.appUrl}/invite/${token}`;
  const text = t(opts.kind === "reset" ? "whatsappReset" : "whatsappInvite", {
    name: profile?.full_name ?? "",
    kindergarten: kgRow?.name ?? "Happy Steps",
    url,
  });
  return { url, text, whatsapp: whatsappLink(profile?.phone ?? "", text), expiresAt };
}

/** Creates (or finds) a person and adds them to a kindergarten with a role. */
export async function addPersonToKindergarten(opts: {
  supabase: SupabaseClient;
  actorId: string;
  kgId: string;
  fullName: string;
  phone: string;
  role: Role;
  position?: string | null;
}): Promise<{ userId: string; existed: boolean; result: "created" | "reactivated" | "exists"; invite: InviteLink | null }> {
  const { data: allowed } = await opts.supabase.rpc("can_manage_role", { kg: opts.kgId, target: opts.role });
  if (!allowed) throw new ActionError("forbidden");
  const { userId, existed, activated } = await findOrCreateUser(opts.fullName, opts.phone);
  const result = await addMembership(opts.supabase, opts.kgId, userId, opts.role, opts.position);
  const invite = activated ? null : await createInvite({ userId, kgId: opts.kgId, kind: "invite", createdBy: opts.actorId });
  if (result !== "exists") {
    await audit(opts.supabase, opts.kgId, "account.create", "membership", userId, { role: opts.role, existed });
  }
  return { userId, existed: existed && activated, result, invite };
}

/** True if the acting user may manage at least one of the person's roles in this kindergarten. */
export async function assertCanManageUser(supabase: SupabaseClient, kgId: string, userId: string, opts: { allRoles?: boolean } = {}) {
  const service = createServiceClient();
  const { data: ms } = await service.from("memberships").select("role").eq("kindergarten_id", kgId).eq("user_id", userId);
  if (!ms?.length) throw new ActionError("notFound");
  const results = await Promise.all(
    ms.map(async (m) => (await supabase.rpc("can_manage_role", { kg: kgId, target: m.role })).data === true),
  );
  const ok = opts.allRoles ? results.every(Boolean) : results.some(Boolean);
  if (!ok) throw new ActionError("forbidden");
  return ms.map((m) => m.role as Role);
}

"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { phoneToAuthEmail } from "@/lib/phone";
import { CONTEXT_COOKIE } from "@/lib/auth/constants";
import { lookupInvite } from "./lookup";

export interface InviteState {
  error?: "passwordMin" | "passwordsMismatch" | "inviteInvalid";
}

export async function acceptInviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const password2 = String(form.get("password2") ?? "");
  if (password.length < 8) return { error: "passwordMin" };
  if (password !== password2) return { error: "passwordsMismatch" };

  const invite = await lookupInvite(token);
  if (!invite) return { error: "inviteInvalid" };

  const service = createServiceClient();
  // Mark used first (single use even under concurrent submits).
  const { data: claimed } = await service
    .from("invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) return { error: "inviteInvalid" };

  const { error } = await service.auth.admin.updateUserById(invite.userId, { password });
  if (error) return { error: "inviteInvalid" };
  await service.from("profiles").update({ activated_at: new Date().toISOString() }).eq("id", invite.userId).is("activated_at", null);

  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(CONTEXT_COOKIE);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(invite.rawPhone, serverEnv.authEmailDomain),
    password,
  });
  if (signInError) redirect("/login");
  redirect("/");
}

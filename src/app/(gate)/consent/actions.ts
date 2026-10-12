"use server";

import { redirect } from "next/navigation";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export async function acceptConsentAction() {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") redirect("/");
  const supabase = await createClient();
  // Consent is per kindergarten (its text is set in that kindergarten's settings).
  await supabase
    .from("memberships")
    .update({ consent_at: new Date().toISOString() })
    .eq("user_id", r.ctx.userId)
    .eq("kindergarten_id", r.ctx.kg.id)
    .is("consent_at", null);
  redirect("/");
}

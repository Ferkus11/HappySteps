"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE } from "@/i18n/config";
import { zOptionalDate } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions/result";

const schema = z.object({ locale: z.enum(["ru", "kk"]), birthDate: zOptionalDate });

export async function saveProfileAction(input: z.input<typeof schema>): Promise<ActionResult> {
  const v = schema.safeParse(input);
  if (!v.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "forbidden" };
  const { error } = await supabase.from("profiles").update({ locale: v.data.locale, birth_date: v.data.birthDate }).eq("id", data.user.id);
  if (error) return { ok: false, error: "generic" };
  (await cookies()).set(LOCALE_COOKIE, v.data.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { ok: true };
}

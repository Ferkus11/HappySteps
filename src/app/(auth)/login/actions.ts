"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { serverEnv } from "@/lib/env";
import { normalizePhone, phoneToAuthEmail } from "@/lib/phone";

export interface LoginState {
  error?: "invalidCredentials" | "tooManyAttempts" | "phoneInvalid" | "passwordMin";
  retryMinutes?: number;
  phone?: string;
}

const WINDOW_MIN = 15;
const MAX_FAILS = 5;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const rawPhone = String(form.get("phone") ?? "");
  const password = String(form.get("password") ?? "");
  const phone = normalizePhone(rawPhone);
  if (!phone) return { error: "phoneInvalid", phone: rawPhone };
  if (password.length < 8) return { error: "invalidCredentials", phone: rawPhone };

  const h = await headers();
  // Unknown IP (no trusted proxy header) → one shared bucket; the per-phone limit still applies.
  const ip = clientIp(h) ?? "unknown";
  const service = createServiceClient();

  // Rate limit: max 5 failed attempts per phone (or per IP x5) in 15 minutes.
  const { data: limit } = await service.rpc("login_attempts_check", {
    p_phone: phone,
    p_ip: ip,
    p_window_minutes: WINDOW_MIN,
    p_max_fails: MAX_FAILS,
  });
  if (limit === false) return { error: "tooManyAttempts", retryMinutes: WINDOW_MIN, phone: rawPhone };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(phone, serverEnv.authEmailDomain),
    password,
  });
  await service.rpc("login_attempts_record", { p_phone: phone, p_ip: ip, p_success: !error });
  if (error) return { error: "invalidCredentials", phone: rawPhone };
  redirect("/");
}

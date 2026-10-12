import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get anonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  /** Technical e-mail domain for phone-based accounts (see DECISIONS.md D-004). */
  get authEmailDomain() {
    return process.env.AUTH_EMAIL_DOMAIN ?? "users.happysteps.local";
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
};

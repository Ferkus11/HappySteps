// Writes .env.local with keys for the local stack (only if values are missing).
import { SignJWT } from "jose";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const secret = new TextEncoder().encode(process.argv[2]);
const root = resolve(import.meta.dirname, "../..");
const envPath = resolve(root, ".env.local");

const sign = (role) =>
  new SignJWT({ role, iss: "supabase-local" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(secret);

const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const has = (k) => new RegExp(`^${k}=`, "m").test(current);
const lines = [];
const add = (k, v) => {
  if (!has(k)) lines.push(`${k}=${v}`);
};

add("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
add("NEXT_PUBLIC_SUPABASE_ANON_KEY", await sign("anon"));
add("SUPABASE_SERVICE_ROLE_KEY", await sign("service_role"));
add("SUPABASE_DB_URL", "postgres://postgres:postgres@127.0.0.1:5432/happysteps");
add("APP_URL", "http://localhost:3000");
add("AUTH_EMAIL_DOMAIN", "users.happysteps.local");
add("CRON_SECRET", randomBytes(16).toString("hex"));

if (lines.length) {
  writeFileSync(envPath, (current ? current.trimEnd() + "\n" : "") + lines.join("\n") + "\n");
  console.log(`→ .env.local updated (${lines.length} keys)`);
}

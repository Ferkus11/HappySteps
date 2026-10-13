/**
 * Creates the first platform superadmin (or grants the role to an existing user). Idempotent.
 *
 *   SUPERADMIN_PASSWORD='…' npm run superadmin:create -- --phone "+77010000000" --name "Имя Фамилия"
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AUTH_EMAIL_DOMAIN (the same values as the
 * app) — from the environment, `.env.local` or `.env`. See README «Первый суперадмин».
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { service, must, EMAIL_DOMAIN } from "./seed/lib";
import { ArgsError, checkPassword, parseSuperadminArgs, type SuperadminOptions } from "./superadmin/args";
import { phoneToAuthEmail } from "../src/lib/phone";

async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new ArgsError("Задайте пароль в переменной SUPERADMIN_PASSWORD (нет терминала для ввода)");
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const p = new Promise<string>((resolve) => rl.question(question, resolve));
  muted = true;
  const answer = await p;
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function obtainPassword(opts: SuperadminOptions): Promise<string> {
  if (opts.password) return opts.password;
  const a = await askHidden("Пароль (мин. 8 символов): ");
  checkPassword(a);
  const b = await askHidden("Повторите пароль: ");
  if (a !== b) throw new ArgsError("Пароли не совпадают");
  return a;
}

async function main() {
  const opts = parseSuperadminArgs(process.argv.slice(2), process.env);
  const db = service();

  const { data: profile, error } = await db.from("profiles").select("id, full_name").eq("phone", opts.phone).maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);

  let userId: string;
  if (profile) {
    userId = profile.id as string;
    console.log(`Пользователь ${opts.phone} уже есть (${profile.full_name}).`);
    if (opts.resetPassword) {
      const password = await obtainPassword(opts);
      const res = await db.auth.admin.updateUserById(userId, { password });
      if (res.error) throw new Error(`updateUserById: ${res.error.message}`);
      must(await db.from("profiles").update({ activated_at: new Date().toISOString() }).eq("id", userId).is("activated_at", null), "activate");
      console.log("✓ пароль изменён");
    }
  } else {
    if (!opts.name) throw new ArgsError("Пользователя с таким телефоном нет — укажите --name, чтобы создать его");
    const password = await obtainPassword(opts);
    const email = phoneToAuthEmail(opts.phone, EMAIL_DOMAIN);
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: opts.name, phone: opts.phone },
    });
    if (created.error || !created.data.user) {
      throw new Error(
        `createUser: ${created.error?.message}. Если логин ${email} уже есть в Auth без профиля — удалите его в Supabase Dashboard → Authentication и повторите.`,
      );
    }
    userId = created.data.user.id;
    must(
      await db.from("profiles").insert({ id: userId, full_name: opts.name, phone: opts.phone, activated_at: new Date().toISOString() }),
      "profile",
    );
    console.log(`✓ создан пользователь ${opts.phone}`);
  }

  must(await db.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }), "platform_admins");
  console.log(`✓ ${opts.phone} — суперадмин. Вход: телефон и пароль на странице /login, раздел «Сады платформы» (/admin).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof ArgsError ? e.message : e);
  process.exit(1);
});

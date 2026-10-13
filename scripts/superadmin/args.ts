import { normalizePhone } from "../../src/lib/phone";

/** Options of `npm run superadmin:create` (scripts/create-superadmin.ts). Pure, unit-tested. */
export type SuperadminOptions = {
  phone: string;
  name: string | null;
  password: string | null;
  resetPassword: boolean;
};

export const USAGE = `Использование:
  SUPERADMIN_PASSWORD='…' npm run superadmin:create -- --phone "+7 701 000 00 00" --name "Имя Фамилия"
  npm run superadmin:create -- --phone "+77010000000" [--reset-password]

  --phone           телефон (логин), обязателен
  --name            имя — нужно, только если такого пользователя ещё нет
  --reset-password  сменить пароль уже существующему пользователю
Пароль берётся из переменной SUPERADMIN_PASSWORD, иначе спрашивается в терминале (не передавайте его аргументом —
он останется в истории команд). Минимум 8 символов.`;

export const MIN_PASSWORD = 8;

export class ArgsError extends Error {}

/** Parses argv (without node/script) and env. Throws ArgsError with a Russian message on bad input. */
export function parseSuperadminArgs(argv: string[], env: Record<string, string | undefined> = {}): SuperadminOptions {
  let phoneRaw: string | null = null;
  let name: string | null = null;
  let resetPassword = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [key, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) throw new ArgsError(`Не указано значение для ${key}`);
      return v;
    };
    switch (key) {
      case "--phone":
        phoneRaw = value();
        break;
      case "--name":
        name = value().trim();
        break;
      case "--reset-password":
        resetPassword = true;
        break;
      case "--password":
        throw new ArgsError("Не передавайте пароль аргументом — используйте SUPERADMIN_PASSWORD или ввод в терминале");
      case "-h":
      case "--help":
        throw new ArgsError(USAGE);
      default:
        throw new ArgsError(`Неизвестный аргумент: ${a}\n\n${USAGE}`);
    }
  }
  if (!phoneRaw) throw new ArgsError(`Укажите --phone\n\n${USAGE}`);
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new ArgsError(`Неверный телефон: ${phoneRaw} (нужен казахстанский номер +7XXXXXXXXXX)`);
  if (name !== null && (name.length < 2 || name.length > 160)) throw new ArgsError("Имя — от 2 до 160 символов");
  const password = env.SUPERADMIN_PASSWORD ? env.SUPERADMIN_PASSWORD : null;
  if (password !== null) checkPassword(password);
  return { phone, name, password, resetPassword };
}

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new ArgsError(`Пароль — минимум ${MIN_PASSWORD} символов`);
}

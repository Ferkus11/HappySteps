import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/config";

/** The `notifications` namespace as stored in messages/<locale>/notifications.json (the parts the renderer reads). */
export interface NotificationMessages {
  fallbackTitle: string;
  months: Record<string, string>;
  monthYear: string;
  types: Record<string, { title: string; body: string }>;
}

export type NotificationParams = Record<string, string | number | null | undefined>;

const ARG = /\{\s*([A-Za-z_]\w*)\s*[,}]/g;
const MONTH = /^(\d{4})-(\d{2})$/;

/**
 * Prepares raw params for the reader's language: `month` = `YYYY-MM` (payments) becomes «Октябрь 2026» /
 * «2026 ж. Қазан»; nulls and parameters the message expects but the row lacks become empty strings, so an
 * older row never breaks the centre. Select values (`reason`, `status`) stay raw — ICU picks the branch.
 */
export function prepareParams(messages: NotificationMessages, locale: Locale, raw: NotificationParams, templates: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const tpl of templates) for (const m of tpl.matchAll(ARG)) out[m[1]] = "";
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = v === null || v === undefined ? "" : v;
  const month = typeof out.month === "string" ? MONTH.exec(out.month) : null;
  if (month) {
    const name = messages.months[String(Number(month[2]))];
    if (name) out.month = fmt(locale, messages.monthYear, { month: name, year: month[1] });
  }
  return out;
}

function fmt(locale: Locale, template: string, values: Record<string, string | number>): string {
  const t = createTranslator({ locale, messages: { x: template }, onError: () => {}, getMessageFallback: () => "" });
  return t("x", values);
}

/** Collapses the gaps an empty optional parameter leaves («13.10.2026  · Сад», «Имя:»). */
const tidy = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s+([:,.])/g, "$1")
    .replace(/^[\s·:,.—]+|[\s·:,—]+$/g, "")
    .trim();

/** Title and body of a notification in `locale`, from its `type` + `params` (DECISIONS D-013). */
export function renderNotification(
  messages: NotificationMessages,
  locale: Locale,
  type: string,
  params: NotificationParams | null | undefined,
): { title: string; body: string } {
  const tpl = messages.types[type];
  if (!tpl) return { title: messages.fallbackTitle, body: "" };
  const values = prepareParams(messages, locale, params ?? {}, [tpl.title, tpl.body]);
  const safe = (template: string) => {
    try {
      return tidy(fmt(locale, template, values));
    } catch {
      return "";
    }
  };
  return { title: safe(tpl.title) || messages.fallbackTitle, body: safe(tpl.body) };
}

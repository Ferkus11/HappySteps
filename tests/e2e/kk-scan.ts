import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Scenario 12 helpers: what a Kazakh screen must not contain.
 *
 * - Russian-only letters ё, щ, ъ. (ы and э are not checked: they are ordinary letters of the Kazakh alphabet —
 *   «Қызметкерлер», «экран».)
 * - Russian words: every Cyrillic word of the ru message files that never occurs in the kk files
 *   («Сохранить», «группа», «детей» …). Shared loanwords (Телефон, Тариф, Банк …) are in both and never flagged.
 *
 * User content is skipped: anything inside `[data-user-content]` (names, group/club/dish titles, messages, comments)
 * and anything marked `lang="ru"` (the «Русский» item of the language switcher).
 */

const MESSAGES = path.join(process.cwd(), "src/messages");

function words(obj: unknown, out: Set<string>) {
  if (typeof obj === "string") {
    for (const w of obj.toLowerCase().match(/\p{L}+/gu) ?? []) if (/[а-яёәғқңөұүһі]/.test(w)) out.add(w);
  } else if (obj && typeof obj === "object") for (const v of Object.values(obj)) words(v, out);
}

function load(locale: "ru" | "kk") {
  const set = new Set<string>();
  for (const f of readdirSync(path.join(MESSAGES, locale))) words(JSON.parse(readFileSync(path.join(MESSAGES, locale, f), "utf8")), set);
  return set;
}

/** Russian words that a translated Kazakh screen never shows (≥ 4 letters, so short shared words never collide). */
export function russianDenyList(): Set<string> {
  const ru = load("ru");
  const kk = load("kk");
  return new Set([...ru].filter((w) => w.length >= 4 && !kk.has(w)));
}

export interface Snippet {
  text: string;
  where: string;
}

/** Visible text and accessible names/placeholders of the page, minus user content. Runs in the browser. */
export async function visibleUiText(page: Page, scope = "body", withTitle = true): Promise<Snippet[]> {
  return page.evaluate(([scope, withTitle]) => {
    const root = document.querySelector(scope as string) ?? document.body;
    const SKIP = "[data-user-content], [lang='ru'], script, style, noscript, template, svg title";
    const out: { text: string; where: string }[] = [];
    const describe = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 4; e = e.parentElement) {
        const id = e.getAttribute("data-testid");
        parts.push(id ? `${e.tagName.toLowerCase()}[${id}]` : e.tagName.toLowerCase());
        if (id) break;
      }
      return parts.reverse().join(" > ");
    };
    const shown = (el: Element) => {
      if (el.closest(SKIP)) return false;
      // <option>s have no box of their own: they count when their <select> is shown.
      const box = el.tagName === "OPTION" ? el.closest("select") : el;
      return !!box && (box as HTMLElement).checkVisibility?.({ checkOpacity: false, checkVisibilityCSS: true }) !== false && box.getClientRects().length > 0;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || !shown(el)) continue;
      out.push({ text, where: describe(el) });
    }
    for (const el of Array.from(root.querySelectorAll("[aria-label], [title], [placeholder], img[alt], [aria-description]"))) {
      if (!shown(el)) continue;
      for (const a of ["aria-label", "title", "placeholder", "alt", "aria-description"]) {
        const v = el.getAttribute(a)?.trim();
        if (v) out.push({ text: v, where: `${describe(el)} @${a}` });
      }
    }
    if (root === document.body && withTitle) out.push({ text: document.title, where: "document.title" });
    return out;
  }, [scope, withTitle] as const);
}

/** Problems on the current screen: Russian-only letters or Russian words outside user content. */
/** `withTitle: false` for detail pages, whose tab title is the record's name (user content). */
export async function russianOnScreen(page: Page, deny: Set<string>, scope?: string, withTitle = true): Promise<string[]> {
  const problems: string[] = [];
  for (const s of await visibleUiText(page, scope, withTitle)) {
    const letters = s.text.match(/[ёщъ]/giu);
    const ruWords = (s.text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => deny.has(w));
    if (letters || ruWords.length) problems.push(`${s.where}: «${s.text.slice(0, 120)}»${ruWords.length ? ` [${ruWords.join(", ")}]` : ""}`);
  }
  return [...new Set(problems)];
}

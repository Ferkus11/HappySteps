import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { loadMessages, namespaces } from "@/messages";

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

describe("i18n", async () => {
  const ru = await loadMessages("ru");
  const kk = await loadMessages("kk");

  for (const ns of namespaces) {
    it(`namespace "${ns}" has identical keys in ru and kk`, () => {
      const a = Object.keys(flatten(ru[ns])).sort();
      const b = Object.keys(flatten(kk[ns])).sort();
      expect(b).toEqual(a);
    });
  }

  it("every message is valid ICU and non-empty", () => {
    for (const [locale, msgs] of [["ru", ru], ["kk", kk]] as const) {
      for (const ns of namespaces) {
        for (const [k, v] of Object.entries(flatten(msgs[ns]))) {
          expect(v.trim(), `${locale}:${ns}.${k}`).not.toBe("");
          expect(() => new IntlMessageFormat(v, locale), `${locale}:${ns}.${k}`).not.toThrow();
        }
      }
    }
  });

  it("Russian plurals use one/few/many forms", () => {
    const f = new IntlMessageFormat(flatten(ru.common).children, "ru");
    expect(f.format({ count: 1 })).toBe("1 ребёнок");
    expect(f.format({ count: 3 })).toBe("3 ребёнка");
    expect(f.format({ count: 5 })).toBe("5 детей");
    expect(f.format({ count: 21 })).toBe("21 ребёнок");
  });

  it("Kazakh strings contain no leftover Russian-only letters", () => {
    // ё, щ, ъ practically never appear in Kazakh UI copy; flags untranslated Russian strings.
    for (const ns of namespaces) {
      for (const [k, v] of Object.entries(flatten(kk[ns]))) {
        if (k.startsWith("languages.")) continue;
        expect(/[ёщъ]/i.test(v.replace(/\{[^}]*\}/g, "")), `kk:${ns}.${k} = ${v}`).toBe(false);
      }
    }
  });
});

/** Strings that are legitimately identical in Russian and Kazakh. */
const SAME_IN_BOTH = new Set([
  "common.appName",
  "common.languages.ru",
  "common.languages.kk",
  "common.phone",
  "common.account",
  "common.export",
  "common.profile",
  "roles.accountant",
]);

describe("i18n: Kazakh is actually translated", async () => {
  const ru = await loadMessages("ru");
  const kk = await loadMessages("kk");
  it("no kk string is a verbatim copy of the Russian one", () => {
    const offenders: string[] = [];
    for (const ns of namespaces) {
      const a = flatten(ru[ns]);
      const b = flatten(kk[ns]);
      for (const [k, v] of Object.entries(b)) {
        const id = `${ns}.${k}`;
        if (SAME_IN_BOTH.has(id)) continue;
        if (v.replace(/\{[^}]*\}|[\d\s.,:;!?()«»"'–—\-+/%₸#]/g, "").length < 4) continue;
        if (a[k] === v) offenders.push(id);
      }
    }
    expect(offenders).toEqual([]);
  });
});

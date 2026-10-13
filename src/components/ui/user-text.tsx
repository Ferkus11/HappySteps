import * as React from "react";

/**
 * A translated sentence with user content inside it (a group name, a person's name): the values are rendered in
 * `<span data-user-content>` so that they stay recognisable as untranslated user data (SPEC §8: user content is
 * not translated; the scenario-12 test skips it). `format` is the translator call, e.g.
 * `withUserValues((v) => t("insight", { ...v, rate }), { group: g.name })`.
 */
export function withUserValues(format: (values: Record<string, string>) => string, values: Record<string, string>): React.ReactNode {
  const keys = Object.keys(values);
  const marks = Object.fromEntries(keys.map((k, i) => [k, `\u0001${i}\u0001`]));
  const parts = format(marks).split(/\u0001(\d+)\u0001/);
  return parts.map((p, i) =>
    i % 2 === 0 ? (
      p
    ) : (
      <span key={i} data-user-content>
        {values[keys[Number(p)]]}
      </span>
    ),
  );
}

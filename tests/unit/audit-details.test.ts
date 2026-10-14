import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { loadMessages } from "@/messages";
import { formatMoney } from "@/lib/format";
import { auditRefs, describeAudit, type AuditNames, type AuditTranslator } from "@/lib/audit-details";

async function translator(locale: "ru" | "kk"): Promise<AuditTranslator> {
  const msgs = (await loadMessages(locale)) as unknown as Record<string, unknown>;
  const get = (key: string): unknown => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), msgs);
  const t = ((key: string, values?: Record<string, string | number>) => {
    const raw = get(key);
    if (typeof raw !== "string") throw new Error(`missing ${key}`);
    return String(new IntlMessageFormat(raw, locale).format(values));
  }) as AuditTranslator;
  t.has = (key) => typeof get(key) === "string";
  return t;
}

const CHILD = "70131ffa-fb52-4bca-9ffa-ccce58780500";
const PARENT = "fcceddac-2d49-458d-8a43-0c70f5d66900";
const GROUP = "220d2f8c-1235-477a-b21d-38e4be5c175e";
const names: AuditNames = {
  people: new Map([[PARENT, "Ахметова Дана"]]),
  children: new Map([[CHILD, "Ахметов Алихан"]]),
  groups: new Map([[GROUP, "Солнышко"]]),
};
const TZ = "Asia/Almaty";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}/i;

describe("audit details", async () => {
  const ru = await translator("ru");
  const kk = await translator("kk");
  const row = (action: string, details: unknown, entity_id: string | null = null) => ({ action, entity: null, entity_id, details });

  it("receipt reject: child, month, reason — no ids, nulls or keys", () => {
    const r = row("receipt.reject", { invoice_id: CHILD, child_id: CHILD, period: "2026-10-01", amount: null, reason: "Сумма не совпадает", balance: 60000 });
    expect(describeAudit(r, ru, names, TZ)).toBe("Ахметов Алихан · Октябрь 2026 · причина: Сумма не совпадает");
    expect(describeAudit(r, kk, names, TZ)).toBe("Ахметов Алихан · 2026 ж. Қазан · себебі: Сумма не совпадает");
  });

  it("translates enum values and hides unknown ids", () => {
    expect(describeAudit(row("account.create", { role: "parent", existed: false }, "00000000-0000-4000-8000-000000000000"), ru, names, TZ)).toBe("Родитель · новый аккаунт");
    expect(describeAudit(row("child.archive", { reason: "moved" }, CHILD), ru, names, TZ)).toBe("Ахметов Алихан · причина: Переезд");
    expect(describeAudit(row("receipt.revert", { child_id: CHILD, period: "2026-10-01", from: "accepted", amount: 80000, reject_reason: null, reason: "Не та сумма" }), ru, names, TZ)).toBe(
      `Ахметов Алихан · Октябрь 2026 · было: Принят, ${formatMoney(80000)} · причина: Не та сумма`,
    );
    expect(describeAudit(row("kindergarten.settings", { section: "meals", meals: ["breakfast", "lunch"] }), kk, names, TZ)).toBe("бөлім: Тамақтану · Таңғы ас, Түскі ас");
    expect(describeAudit(row("guardian.link", { parent: PARENT }, CHILD), ru, names, TZ)).toBe("родитель: Ахметова Дана · ребёнок: Ахметов Алихан");
    expect(describeAudit(row("attendance.edit_past", { date: "2026-10-12", status: "absent", previous: "present" }, CHILD), ru, names, TZ)).toBe("Ахметов Алихан · 12.10.2026 · Был → Не был");
    expect(describeAudit(row("chat.lock", { group_id: GROUP }), ru, names, TZ)).toBe("группа: Солнышко");
  });

  it("unknown actions never print raw JSON or ids", () => {
    const r = row("something.new", { foo: CHILD, list: ["a"], n: null }, CHILD);
    expect(describeAudit(r, ru, names, TZ)).toBe("Ахметов Алихан");
    expect(describeAudit(row("something.new", { foo: "bar" }, CHILD.replace("7", "8")), ru, names, TZ)).toBeNull();
  });

  it("no output contains a UUID, 'null' or JSON", () => {
    const samples = [
      row("waitlist.accept", { child: CHILD, name: "Очередин Айдос", parent: "eb8289e2-127e-46ff-a59b-65d95f52fea7" }),
      row("worktime.edit", { user_id: PARENT, comment: "Пришла раньше", old_start: "2026-10-12T04:00:00+00:00", old_end: "2026-10-12T11:30:00+00:00", new_start: "2026-10-12T03:30:00+00:00", new_end: "2026-10-12T11:30:00+00:00" }),
      row("chat.message_delete", { chat_id: CHILD, group_id: GROUP, author_id: PARENT, text: "Привет" }),
      row("invoice.accrue", { period: "2026-10-01", count: 4 }),
      row("document.delete", { child: CHILD, category: "medical", title: "Справка" }),
    ];
    for (const s of samples) {
      const out = describeAudit(s, ru, names, TZ) ?? "";
      expect(out).not.toMatch(UUID_RE);
      expect(out).not.toMatch(/null|[{}[\]"]/);
    }
    expect(describeAudit(samples[1], ru, names, TZ)).toBe("Ахметова Дана · 12.10.2026 · 09:00–16:30 → 08:30–16:30 · комментарий: Пришла раньше");
  });

  it("collects referenced ids", () => {
    expect(auditRefs([row("x", { a: CHILD, b: "text" }, GROUP)]).sort()).toEqual([CHILD, GROUP].sort());
  });
});

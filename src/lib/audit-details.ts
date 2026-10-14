/**
 * Turns an audit_log row's `details` JSON into one readable, translated line for the owner (UX review #4).
 * Each known action has its own composition of translated parts (messages `audit.detail.*` plus existing
 * labels: roles, reasons, document categories…). IDs and empty values are never shown: ids are resolved to
 * names when the caller knows them and dropped otherwise. Unknown actions fall back to the subject's name.
 */
import { formatDate, formatMoney, formatTime } from "@/lib/format";

/** Root translator (all namespaces) — `t("audit.detail.reason", { reason })`. */
export interface AuditTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

export interface AuditNames {
  people: Map<string, string>;
  children: Map<string, string>;
  groups: Map<string, string>;
}

export interface AuditRow {
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEP = " · ";

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Every UUID an audit row refers to (entity id and detail values), for one batched name lookup. */
export function auditRefs(rows: AuditRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (isUuid(r.entity_id)) out.add(r.entity_id);
    const d = asObject(r.details);
    for (const v of Object.values(d)) if (isUuid(v)) out.add(v);
  }
  return [...out];
}

function asObject(d: unknown): Record<string, unknown> {
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s && !isUuid(s) ? s : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function shorten(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function describeAudit(row: AuditRow, t: AuditTranslator, names: AuditNames, tz: string): string | null {
  const d = asObject(row.details);
  const k = (key: string, values?: Record<string, string | number>) => t(`audit.detail.${key}`, values);
  /** Label from another namespace, e.g. ("roles", "parent"); unknown values are dropped, never shown raw. */
  const label = (ns: string, value: unknown): string | null => {
    const v = typeof value === "string" ? value : null;
    return v && t.has(`${ns}.${v}`) ? t(`${ns}.${v}`) : null;
  };
  const person = (v: unknown) => (isUuid(v) ? (names.people.get(v) ?? null) : str(v));
  const child = (v: unknown) => (isUuid(v) ? (names.children.get(v) ?? null) : str(v));
  const group = (v: unknown) => (isUuid(v) ? (names.groups.get(v) ?? null) : str(v));
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v, tz) : null);
  const time = (v: unknown) => (typeof v === "string" && v ? formatTime(v, tz) : null);
  const money = (v: unknown) => (num(v) === null ? null : formatMoney(num(v)));
  const period = (v: unknown) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}/.test(v)) return null;
    return t("analytics.label.month", { month: t(`analytics.months.${Number(v.slice(5, 7))}`), year: v.slice(0, 4) });
  };
  const quoted = (v: unknown) => {
    const s = str(v);
    return s ? k("quoted", { text: shorten(s) }) : null;
  };
  const part = (key: string, value: string | null, param = "value") => (value ? k(key, { [param]: value }) : null);
  const change = (from: string | null, to: string | null) => (from && to ? k("change", { from, to }) : (to ?? null));

  const subjectPerson = person(row.entity_id);
  const subjectChild = child(row.entity_id);
  const subjectGroup = group(row.entity_id);
  const reason = part("reason", str(d.reason));
  const comment = part("comment", str(d.comment));

  let parts: (string | null | undefined)[];
  switch (row.action) {
    case "kindergarten.create":
      parts = [quoted(d.name), part("owner", person(d.owner))];
      break;
    case "kindergarten.settings": {
      const section = d.section === "owner" ? "general" : typeof d.section === "string" ? d.section : null;
      const meals = Array.isArray(d.meals) ? d.meals.map((m) => label("settings.mealNames", m)).filter(Boolean).join(", ") : null;
      parts = [part("section", label("settings", section)), meals || null];
      break;
    }
    case "account.create":
      parts = [subjectPerson, label("roles", d.role), d.existed === true ? k("existed") : d.existed === false ? k("newAccount") : null];
      break;
    case "account.archive":
    case "account.restore": {
      const roles = Array.isArray(d.roles) ? d.roles : [d.role];
      parts = [subjectPerson, roles.map((r) => label("roles", r)).filter(Boolean).join(", ") || null];
      break;
    }
    case "account.delete":
      parts = [str(d.name) ?? subjectPerson];
      break;
    case "group.create":
    case "group.update":
    case "group.delete":
      parts = [quoted(d.name ?? subjectGroup)];
      break;
    case "group.transfer": {
      const n = num(d.children);
      parts = [change(group(row.entity_id), group(d.to_group)), part("fromDate", date(d.date), "date"), n === null ? null : t("common.children", { count: n })];
      break;
    }
    case "child.create":
      parts = [str(d.name) ?? subjectChild];
      break;
    case "child.transfer":
      parts = [subjectChild, change(group(d.from_group), group(d.to_group)), part("fromDate", date(d.date), "date")];
      break;
    case "child.archive":
      parts = [subjectChild, part("reason", label("children.archiveReasons", d.reason))];
      break;
    case "child.restore":
      parts = [subjectChild];
      break;
    case "child.fee_change":
      parts = [subjectChild, change(money(d.from), money(d.to))];
      break;
    case "guardian.link":
    case "guardian.unlink":
      parts = [part("parent", person(d.parent), "name"), part("child", subjectChild, "name")];
      break;
    case "waitlist.accept":
      parts = [str(d.name) ?? child(d.child), part("parent", person(d.parent), "name")];
      break;
    case "waitlist.delete":
      parts = [str(d.name)];
      break;
    case "worktime.schedule": {
      const days = Array.isArray(d.days)
        ? d.days
            .map((x) => (typeof x === "string" ? /^(\d):(\d\d:\d\d)-(\d\d:\d\d)$/.exec(x) : null))
            .map((m) => (m && t.has(`worktime.weekdays.${m[1]}`) ? `${t(`worktime.weekdays.${m[1]}`)} ${m[2]}–${m[3]}` : null))
            .filter(Boolean)
            .join(", ")
        : null;
      parts = [subjectPerson, days || null];
      break;
    }
    case "worktime.override":
      parts = [
        subjectPerson,
        date(d.date),
        d.removed === true
          ? k("removed")
          : d.kind === "day_off"
            ? k("dayOff")
            : d.kind === "shift" && time(d.start) && time(d.end)
              ? k("shift", { start: time(d.start)!, end: time(d.end)! })
              : null,
      ];
      break;
    case "worktime.absence": {
      const from = date(d.from);
      const to = date(d.to);
      parts = [subjectPerson, label("worktime.absence", d.kind), from && to ? (from === to ? from : k("dates", { from, to })) : from, d.removed === true ? k("removed") : null];
      break;
    }
    case "worktime.edit":
    case "worktime.session_edit": {
      const span = (s: unknown, e: unknown) => (time(s) ? `${time(s)}–${time(e) ?? "…"}` : null);
      const before = span(d.old_start, d.old_end);
      const after = span(d.new_start, d.new_end);
      parts = [
        person(d.user_id),
        date(d.new_start ?? d.old_start),
        d.added === true ? part("added", after) : change(before, after),
        comment,
      ];
      break;
    }
    case "worktime.auto_close":
      parts = [person(d.user_id), date(d.work_date), part("closedAt", time(d.ended_at))];
      break;
    case "attendance.edit_past": {
      const status = (v: unknown) => (v === "present" || v === "absent" ? t(`attendance.${v}`) : null);
      const to = status(d.status) ?? k("cleared");
      parts = [subjectChild, date(d.date), change(status(d.previous), to)];
      break;
    }
    case "attendance.absence_cancel":
      parts = [];
      break;
    case "holidays.update": {
      const filled = num(d.filled);
      parts =
        filled !== null
          ? [k("holidaysFilled", { count: filled })]
          : d.removed === true
            ? [k("removed")]
            : [str(d.name), label("holidays.kinds", d.kind), date(row.entity_id)];
      break;
    }
    case "announcement.delete": {
      const files = num(d.files);
      parts = [quoted(d.title), files ? k("files", { count: files }) : null];
      break;
    }
    case "event.delete":
      parts = [quoted(d.title), date(d.date)];
      break;
    case "invoice.accrue": {
      const n = num(d.count);
      parts = [period(d.period), n === null ? null : k("invoices", { count: n })];
      break;
    }
    case "invoice.adjust":
      parts = [child(d.child_id), period(d.period), change(money(d.from), money(d.to)), comment];
      break;
    case "receipt.confirm": {
      const balance = num(d.balance);
      parts = [child(d.child_id), period(d.period), money(d.amount), balance ? k("balance", { amount: formatMoney(balance) }) : null];
      break;
    }
    case "receipt.reject":
      parts = [child(d.child_id), period(d.period), reason];
      break;
    case "receipt.revert":
      parts = [
        child(d.child_id),
        period(d.period),
        part("was", [label("payments.receiptStatus", d.from), money(d.amount)].filter(Boolean).join(", ") || null),
        reason,
      ];
      break;
    case "chat.message_delete":
      parts = [part("group", group(d.group_id), "name"), part("author", person(d.author_id), "name"), quoted(d.text)];
      break;
    case "chat.lock":
    case "chat.unlock":
      parts = [part("group", group(d.group_id), "name")];
      break;
    case "club.exclude":
      parts = [child(d.child), part("club", str(d.club), "name"), reason];
      break;
    case "club.delete": {
      const n = num(d.children);
      parts = [quoted(d.name), n ? t("common.children", { count: n }) : null];
      break;
    }
    case "document.delete":
      parts = [
        quoted(d.title),
        label("documents.categories", d.category) ?? label("documents.types", d.type),
        child(d.child) ?? person(d.person),
      ];
      break;
    default:
      // Unknown action: never print its raw JSON — just who or what it concerns, when we know.
      parts = [subjectPerson ?? subjectChild ?? (subjectGroup ? quoted(subjectGroup) : null)];
  }
  const line = parts.filter((p): p is string => !!p).join(SEP);
  return line || null;
}

import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import {
  activeInsight,
  attendanceTotals,
  bucketize,
  calendarPeriod,
  change,
  churnInsight,
  comparison,
  debtorsInsight,
  fillInsight,
  financeTotals,
  funnelInsight,
  granularity,
  groupsInsight,
  hoursInsight,
  overdueDays,
  parsePeriod,
  payDaysInsight,
  pct,
  periodQuery,
  rateInsight,
  sectionsFor,
  shiftPeriod,
  staffInsight,
  topAbsenceInsight,
  type AttendanceGroup,
  type FunnelData,
  type StaffRow,
} from "@/lib/analytics";
import { formatMoney } from "@/lib/format";
import { periodLabel, periodThan, periodWhen, renderInsight, type T } from "@/lib/analytics-view";
import ru from "@/messages/ru/analytics.json";
import kk from "@/messages/kk/analytics.json";

/** A tiny translator over the real message files (same ICU engine as next-intl). */
function translator(messages: Record<string, unknown>, locale: string): T {
  return (key, values) => {
    const msg = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages);
    if (typeof msg !== "string") throw new Error(`missing ${key}`);
    return String(new IntlMessageFormat(msg, locale).format(values));
  };
}
const tRu = translator(ru, "ru");
const tKk = translator(kk, "kk");

const group = (o: Partial<AttendanceGroup>): AttendanceGroup => ({
  id: o.name ?? "g",
  name: "Г",
  color: "#000000",
  capacity: 20,
  children: 10,
  present: 0,
  absent: 0,
  sick: 0,
  unmarked: 0,
  ...o,
});

describe("analytics · access (SPEC §3.4)", () => {
  it("owner all, head without finances, accountant finances only, others nothing", () => {
    expect(sectionsFor("owner")).toEqual(["attendance", "staff", "finance", "funnel"]);
    expect(sectionsFor("head")).toEqual(["attendance", "staff", "funnel"]);
    expect(sectionsFor("accountant")).toEqual(["finance"]);
    for (const r of ["teacher", "club_teacher", "cook", "parent"] as const) expect(sectionsFor(r)).toEqual([]);
  });
});

describe("analytics · periods", () => {
  it("calendar units containing a date (weeks start on Monday)", () => {
    expect(calendarPeriod("week", "2026-10-13")).toEqual({ kind: "week", from: "2026-10-12", to: "2026-10-18" });
    expect(calendarPeriod("week", "2026-10-18")).toEqual({ kind: "week", from: "2026-10-12", to: "2026-10-18" });
    expect(calendarPeriod("month", "2024-02-10")).toEqual({ kind: "month", from: "2024-02-01", to: "2024-02-29" });
    expect(calendarPeriod("quarter", "2026-11-30")).toEqual({ kind: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(calendarPeriod("year", "2026-10-13")).toEqual({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
  });

  it("parses the URL with safe fallbacks", () => {
    const today = "2026-10-13";
    expect(parsePeriod({}, today)).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriod({ p: "quarter", d: "2026-05-02" }, today)).toEqual({ kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
    expect(parsePeriod({ p: "week", d: "2026-02-30" }, today)).toEqual({ kind: "week", from: "2026-10-12", to: "2026-10-18" });
    expect(parsePeriod({ p: "custom", from: "2026-09-20", to: "2026-09-05" }, today)).toEqual({ kind: "custom", from: "2026-09-05", to: "2026-09-20" });
    expect(parsePeriod({ p: "custom", from: "2025-01-01", to: "2026-10-01" }, today).kind).toBe("month"); // > 366 days
    expect(parsePeriod({ p: "hack", from: "x" }, today).kind).toBe("month");
    expect(periodQuery(parsePeriod({ p: "custom", from: "2026-09-01", to: "2026-09-10" }, today))).toEqual({ p: "custom", from: "2026-09-01", to: "2026-09-10" });
  });

  it("previous/next: neighbouring calendar unit; custom shifts by its own length", () => {
    expect(shiftPeriod(calendarPeriod("month", "2026-03-15"), -1)).toEqual({ kind: "month", from: "2026-02-01", to: "2026-02-28" });
    expect(shiftPeriod(calendarPeriod("quarter", "2026-02-01"), -1)).toEqual({ kind: "quarter", from: "2025-10-01", to: "2025-12-31" });
    expect(shiftPeriod(calendarPeriod("year", "2026-02-01"), 1)).toEqual({ kind: "year", from: "2027-01-01", to: "2027-12-31" });
    expect(shiftPeriod({ kind: "custom", from: "2026-09-11", to: "2026-09-20" }, -1)).toEqual({ kind: "custom", from: "2026-09-01", to: "2026-09-10" });
  });

  it("a running period is compared with the same number of days of the previous one", () => {
    const c = comparison(calendarPeriod("month", "2026-10-13"), "2026-10-13");
    expect(c).toEqual({ cur: { from: "2026-10-01", to: "2026-10-13" }, prev: { from: "2026-09-01", to: "2026-09-13" }, running: true });
    // March 1–31 running on the 31st? not running (today = last day) → full previous month
    expect(comparison(calendarPeriod("month", "2026-03-31"), "2026-03-31").prev).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // running 30 days into March vs February (28 days) → capped at February's end
    expect(comparison(calendarPeriod("month", "2026-03-30"), "2026-03-30").prev).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // a past period: full vs full
    expect(comparison(calendarPeriod("month", "2026-09-01"), "2026-10-13")).toEqual({
      cur: { from: "2026-09-01", to: "2026-09-30" },
      prev: { from: "2026-08-01", to: "2026-08-31" },
      running: false,
    });
  });
});

describe("analytics · comparison numbers", () => {
  it("rates change in points, amounts in % of the previous value", () => {
    expect(change(87, 83, "points")).toEqual({ dir: "up", value: 4 });
    expect(change(80, 83.4, "points")).toEqual({ dir: "down", value: 3 });
    expect(change(83.2, 83.4, "points")).toEqual({ dir: "same", value: 0 });
    expect(change(12, 10, "relative")).toEqual({ dir: "up", value: 20 });
    expect(change(5, 10, "relative")).toEqual({ dir: "down", value: 50 });
    expect(change(5, 0, "relative")).toBeNull();
    expect(change(null, 3, "points")).toBeNull();
    expect(change(3, null, "points")).toBeNull();
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
  });

  it("attendance totals: rate over marked days, sickness share of absences, occupancy", () => {
    const days = [
      { d: "2026-10-01", enrolled: 10, present: 8, absent: 2, sick: 1, unmarked: 0 },
      { d: "2026-10-02", enrolled: 10, present: 6, absent: 2, sick: 2, unmarked: 2 },
    ];
    const t = attendanceTotals(days, [group({ capacity: 10, children: 6 }), group({ capacity: 10, children: 12 })]);
    expect(t).toMatchObject({ present: 14, absent: 4, sick: 3, unmarked: 2, rate: 77.8, sickShare: 75, children: 18, capacity: 20, fill: 90, free: 2 });
  });

  it("finance totals: collection and the average payment delay weighted by paid invoices", () => {
    const m = (o: object) => ({ period: "2026-09-01", invoices: 2, charged: 100, paid: 50, debt: 50, overdue: 50, paid_invoices: 1, avg_days: 10, ...o });
    const t = financeTotals([m({}), m({ period: "2026-10-01", charged: 100, paid: 100, debt: 0, overdue: 0, paid_invoices: 3, avg_days: 2 })]);
    expect(t).toMatchObject({ charged: 200, paid: 150, debt: 50, collection: 75, avgDays: 4, invoices: 4 });
    expect(financeTotals([m({ paid_invoices: 0, avg_days: null })]).avgDays).toBeNull();
    expect(overdueDays("2026-10-10", "2026-10-13")).toBe(3);
    expect(overdueDays("2026-10-20", "2026-10-13")).toBe(0);
  });

  it("series: days up to two months, then weeks, then months; sums or keeps the last value", () => {
    expect(granularity(31)).toBe("day");
    expect(granularity(92)).toBe("week");
    expect(granularity(365)).toBe("month");
    const pts = [
      { d: "2026-10-12", n: 3 },
      { d: "2026-10-14", n: 5 },
      { d: "2026-10-19", n: 7 },
    ];
    expect(bucketize(pts, "week")).toEqual([
      { d: "2026-10-12", n: 8, days: 2 },
      { d: "2026-10-19", n: 7, days: 1 },
    ]);
    expect(bucketize(pts, "month", "last")).toEqual([{ d: "2026-10-01", n: 7, days: 3 }]);
  });
});

describe("analytics · insights (ru + kk, plurals)", () => {
  const oct = calendarPeriod("month", "2026-10-13");
  const sep = { from: "2026-09-01", to: "2026-09-13" };
  const ph = (t: T) => ({ when: periodWhen(t, "month", oct), than: periodThan(t, "month", sep) });

  it("the spec example: attendance in October vs September", () => {
    expect(renderInsight(tRu, rateInsight("attendance", 87.2, 83.1), ph(tRu))).toBe("Посещаемость в октябре — 87%, на 4% выше сентября");
    expect(renderInsight(tKk, rateInsight("attendance", 87.2, 83.1), ph(tKk))).toBe("Қатысу қазанда — 87%, қыркүйектен 4% жоғары");
    expect(renderInsight(tRu, rateInsight("attendance", 80, 83), ph(tRu))).toBe("Посещаемость в октябре — 80%, на 3% ниже сентября");
    expect(renderInsight(tRu, rateInsight("attendance", 80, 80.2), ph(tRu))).toBe("Посещаемость в октябре — 80%, на уровне сентября");
    expect(renderInsight(tRu, rateInsight("attendance", 80, null), ph(tRu))).toBe("Посещаемость в октябре — 80%");
    expect(rateInsight("attendance", null, 80)).toBeNull();
  });

  it("other period kinds name themselves", () => {
    const q = calendarPeriod("quarter", "2026-10-01");
    const prevQ = shiftPeriod(q, -1);
    expect(renderInsight(tRu, rateInsight("attendance", 90, 85), { when: periodWhen(tRu, "quarter", q), than: periodThan(tRu, "quarter", prevQ) })).toBe(
      "Посещаемость в 4 квартале — 90%, на 5% выше 3 квартала",
    );
    expect(renderInsight(tKk, rateInsight("attendance", 90, 85), { when: periodWhen(tKk, "year", q), than: periodThan(tKk, "year", { from: "2025-01-01", to: "2025-12-31" }) })).toBe(
      "Қатысу 2026 жылы — 90%, 2025 жылдан 5% жоғары",
    );
    expect(periodLabel(tRu, oct)).toBe("Октябрь 2026");
    expect(periodLabel(tKk, oct)).toBe("2026 ж. Қазан");
    expect(periodLabel(tRu, q)).toBe("4 квартал 2026");
    expect(periodLabel(tRu, calendarPeriod("week", "2026-10-13"))).toBe("12.10 – 18.10.2026");
  });

  it("groups, occupancy and top absences", () => {
    const gs = [group({ name: "Солнышко", present: 90, absent: 10, capacity: 20, children: 18 }), group({ name: "Звёздочки", present: 30, absent: 20, sick: 5, capacity: 10, children: 9 })];
    expect(renderInsight(tRu, groupsInsight(gs), ph(tRu))).toBe("Лучше всех ходят в «Солнышко» (90%), реже всего — в «Звёздочки» (60%)");
    expect(renderInsight(tRu, fillInsight(gs), ph(tRu))).toBe("Сад заполнен на 90%: свободно 3 места");
    expect(renderInsight(tRu, fillInsight([group({ capacity: 10, children: 9 })]), ph(tRu))).toBe("Сад заполнен на 90%: свободно 1 место");
    expect(renderInsight(tRu, fillInsight([group({ capacity: 10, children: 5 })]), ph(tRu))).toBe("Сад заполнен на 50%: свободно 5 мест");
    expect(renderInsight(tRu, fillInsight([group({ name: "А", capacity: 2, children: 3 })]), ph(tRu))).toBe("Сад заполнен на 150%; сверх вместимости 1 группа, например «А»");
    expect(renderInsight(tKk, fillInsight([group({ capacity: 10, children: 10 })]), ph(tKk))).toBe("Бала бақша 100% толы: бос орын жоқ");
    expect(renderInsight(tRu, topAbsenceInsight(gs), ph(tRu))).toBe("Больше всего пропусков — в группе «Звёздочки»: 20 детодней");
    expect(topAbsenceInsight([group({})])).toBeNull();
    expect(groupsInsight([group({})])).toBeNull();
  });

  it("staff discipline and hours", () => {
    const row = (o: Partial<StaffRow>): StaffRow => ({
      user_id: "u",
      full_name: "Иванова Анна",
      archived: false,
      scheduled_days: 20,
      worked_days: 18,
      late_days: 0,
      late_minutes: 0,
      absent_days: 0,
      sick_days: 0,
      vacation_days: 0,
      unmarked_days: 0,
      outside_days: 0,
      planned_minutes: 600,
      worked_minutes: 540,
      auto_closed_days: 0,
      edited_days: 0,
      ...o,
    });
    const rows = [row({ late_days: 3, late_minutes: 40, unmarked_days: 1 }), row({ user_id: "b", full_name: "Петров Игорь", late_days: 2, absent_days: 1 })];
    expect(renderInsight(tRu, staffInsight(rows), ph(tRu))).toBe("5 опозданий и 2 пропуска; чаще всех опаздывает Иванова Анна (3 раза)");
    expect(renderInsight(tRu, staffInsight([row({ late_days: 1, absent_days: 1 })]), ph(tRu))).toBe("1 опоздание и 1 пропуск; чаще всех опаздывает Иванова Анна (1 раз)");
    expect(renderInsight(tRu, staffInsight([row({})]), ph(tRu))).toBe("Ни опозданий, ни пропусков");
    expect(renderInsight(tRu, hoursInsight([row({})]), ph(tRu))).toBe("Отработано 90% часов по графику: 9 ч из 10 ч");
    expect(staffInsight([])).toBeNull();
  });

  it("debtors, payment delay, funnel, churn and active children", () => {
    const debtors = [
      { child_id: "1", full_name: "Бекова Сабина", status: "active" as const, group_name: null, debt: 120000, since: "2026-09-10", months: 2 },
      { child_id: "2", full_name: "Касымова Айлин", status: "active" as const, group_name: null, debt: 20000, since: "2026-10-10", months: 1 },
    ];
    expect(renderInsight(tRu, debtorsInsight(debtors, "2026-10-13"), ph(tRu))).toBe(`2 должника на ${formatMoney(140000)}; дольше всех — Бекова Сабина, просрочка 33 дня`);
    expect(renderInsight(tRu, debtorsInsight([], "2026-10-13"), ph(tRu))).toBe("Должников нет — все счета оплачены");
    expect(renderInsight(tRu, payDaysInsight(5.4, 8), ph(tRu))).toBe("В среднем платят через 5 дней после начала месяца, на 3 дн. раньше сентября");
    const f: FunnelData = { applications: 21, contacted: 10, accepted: 5, declined: 2, joined: 4, left: 1, left_reasons: { school: 1 }, active: [{ d: "2026-10-01", n: 100 }, { d: "2026-10-13", n: 103 }] };
    expect(renderInsight(tRu, funnelInsight(f), ph(tRu))).toBe("Из 21 заявки приняты 5: конверсия 24%");
    expect(renderInsight(tRu, churnInsight(f), ph(tRu))).toBe("Новых детей — 4, выбывших — 1; чаще всего причина — «Ушёл в школу»");
    expect(renderInsight(tKk, churnInsight(f), ph(tKk))).toBe("Жаңа балалар — 4, кеткендер — 1; жиі себебі — «Мектепке барды»");
    expect(renderInsight(tRu, activeInsight(f), ph(tRu))).toBe("В конце периода активных детей — 103, на 3 больше, чем в начале");
    expect(funnelInsight({ ...f, applications: 0 })).toBeNull();
    expect(churnInsight({ ...f, joined: 0, left: 0 })).toBeNull();
  });
});

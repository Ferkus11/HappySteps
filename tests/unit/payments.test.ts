import { describe, expect, it } from "vitest";
import {
  advanceOf,
  canAccrueMonth,
  collectedPercent,
  daysBetween,
  displayStatus,
  isOverdue,
  parseMonth,
  paymentPurpose,
  periodParts,
  shiftMonth,
  statementStatus,
  toPay,
  totals,
} from "@/lib/payments";

type St = "unpaid" | "review" | "paid" | "partial" | "rejected";
const inv = (o: Partial<{ balance: number; status: St; due_date: string }> = {}) => ({
  balance: 65000,
  status: "unpaid" as St,
  due_date: "2026-10-10",
  ...o,
});
const stmt = (o: Partial<{ carried: number; balance: number; status: St; debt_since: string | null }> = {}) => ({
  carried: 0,
  balance: 65000,
  status: "unpaid" as St,
  debt_since: "2026-10-10" as string | null,
  ...o,
});

describe("payments · overdue is computed", () => {
  it("one invoice: its own open balance after its own due date, not while a receipt is in review", () => {
    expect(isOverdue(inv(), "2026-10-11")).toBe(true);
    expect(isOverdue(inv(), "2026-10-10")).toBe(false); // due day itself is fine
    expect(isOverdue(inv({ status: "review" }), "2026-10-20")).toBe(false);
    expect(isOverdue(inv({ balance: 0, status: "paid" }), "2026-10-20")).toBe(false);
    expect(isOverdue(inv({ status: "partial", balance: 5000 }), "2026-10-20")).toBe(true);
    // an older month stays overdue on its own (FIFO: its debt is not moved into the next invoice)
    expect(displayStatus(inv({ due_date: "2026-09-10" }), "2026-10-05")).toBe("overdue");
    expect(displayStatus(inv({ status: "rejected" }), "2026-10-20")).toBe("overdue");
    expect(displayStatus(inv({ status: "partial" }), "2026-10-05")).toBe("partial");
  });

  it("statement: a chronic debtor is overdue between the 1st and the due day of the new month", () => {
    // October invoice (due 10.10) not due yet, but September's 60 000 is open since 10.09
    const oct = stmt({ carried: 60000, balance: 60000, debt_since: "2026-09-10" });
    expect(statementStatus(oct, "2026-10-03")).toBe("overdue");
    expect(statementStatus(stmt(), "2026-10-03")).toBe("unpaid"); // only this month owed, not due yet
    expect(statementStatus(stmt(), "2026-10-11")).toBe("overdue");
    expect(statementStatus({ ...oct, status: "review" }, "2026-10-03")).toBe("review");
    expect(statementStatus(stmt({ balance: 0, status: "paid", debt_since: null }), "2026-10-20")).toBe("paid");
    // this month covered (e.g. adjusted to 0) but older months are still open
    expect(statementStatus(stmt({ carried: 5000, balance: 0, status: "paid", debt_since: "2026-11-10" }), "2026-11-05")).toBe("unpaid");
  });
});

describe("payments · balance helpers", () => {
  it("to pay = open older months + this month; advance is separate", () => {
    expect(toPay({ carried: 0, balance: 20000 })).toBe(20000);
    expect(toPay({ carried: 60000, balance: 60000 })).toBe(120000);
    expect(toPay({ carried: 0, balance: 0 })).toBe(0);
    expect(advanceOf({ advance: 10000 })).toBe(10000);
    expect(advanceOf({ advance: 0 })).toBe(0);
  });

  it("totals and collected percent (each debt counted once)", () => {
    const t = totals([
      { amount: 60000, paid_amount: 60000, balance: 0 },
      { amount: 60000, paid_amount: 40000, balance: 20000 },
      { amount: 65000, paid_amount: 65000, balance: 0 },
    ]);
    expect(t).toEqual({ accrued: 185000, paid: 165000, debt: 20000, count: 3 });
    expect(collectedPercent(t)).toBe(89);
    expect(collectedPercent({ accrued: 100, paid: 250 })).toBe(100);
    expect(collectedPercent({ accrued: 0, paid: 0 })).toBe(0);
  });
});

describe("payments · manual accrual window", () => {
  it("current month always; previous month only if it is not before the first billed month; never older or future", () => {
    expect(canAccrueMonth("2026-10", "2026-10-12", null)).toBe(true);
    expect(canAccrueMonth("2026-09", "2026-10-12", null)).toBe(false);
    expect(canAccrueMonth("2026-09", "2026-10-12", "2026-10-01")).toBe(false);
    expect(canAccrueMonth("2026-09", "2026-10-12", "2026-09-01")).toBe(true);
    expect(canAccrueMonth("2026-08", "2026-10-12", "2026-01-01")).toBe(false);
    expect(canAccrueMonth("2026-11", "2026-10-12", "2026-01-01")).toBe(false);
    expect(canAccrueMonth("2025-12", "2026-01-03", "2025-11-01")).toBe(true);
  });
});

describe("payments · months and text", () => {
  it("parses and shifts months", () => {
    expect(parseMonth("2026-09", "2026-10-12")).toBe("2026-09");
    expect(parseMonth("2026-13", "2026-10-12")).toBe("2026-10");
    expect(parseMonth(undefined, "2026-10-12")).toBe("2026-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(periodParts("2026-10-01")).toEqual({ month: 10, year: 2026 });
    expect(daysBetween("2026-09-10", "2026-10-12")).toBe(32);
  });

  it("payment purpose includes the child and the month", () => {
    expect(paymentPurpose("Оплата за детский сад", "Ахметов Алихан", "за октябрь 2026")).toBe("Оплата за детский сад, Ахметов Алихан, за октябрь 2026");
    expect(paymentPurpose("", "Ахметов Алихан", "за октябрь 2026")).toBe("Ахметов Алихан, за октябрь 2026");
  });

  it("month phrases are lower-case mid-sentence in both languages", async () => {
    const { monthLabel, monthPhrase } = await import("@/components/payments/month");
    const { createTranslator } = await import("next-intl");
    const ru = (await import("@/messages/ru/payments.json")).default;
    const kk = (await import("@/messages/kk/payments.json")).default;
    const tr = createTranslator({ locale: "ru", messages: { payments: ru }, namespace: "payments" }) as unknown as Parameters<typeof monthPhrase>[0];
    const tk = createTranslator({ locale: "kk", messages: { payments: kk }, namespace: "payments" }) as unknown as Parameters<typeof monthPhrase>[0];
    expect(monthLabel(tr, "2026-10-01")).toBe("Октябрь 2026");
    expect(tr("invoiceTitle", { month: monthPhrase(tr, "2026-10") })).toBe("Счёт за октябрь 2026");
    expect(tr("forMonth", { month: monthPhrase(tr, "2026-10-01") })).toBe("Начислено за октябрь 2026");
    expect(tk("invoiceTitle", { month: monthPhrase(tk, "2026-10") })).toBe("2026 жылғы қазан айына шот");
  });
});

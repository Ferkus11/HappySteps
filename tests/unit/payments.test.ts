import { describe, expect, it } from "vitest";
import {
  advanceOf,
  collectedPercent,
  daysBetween,
  displayStatus,
  isOverdue,
  parseMonth,
  paymentPurpose,
  periodParts,
  shiftMonth,
  toPay,
  totals,
} from "@/lib/payments";

const inv = (o: Partial<{ balance: number; status: "unpaid" | "review" | "paid" | "partial" | "rejected"; due_date: string }> = {}) => ({
  balance: 65000,
  status: "unpaid" as const,
  due_date: "2026-10-10",
  ...o,
});

describe("payments · overdue is computed", () => {
  it("only the latest invoice with a positive balance after the due date, not while a receipt is in review", () => {
    expect(isOverdue(inv(), "2026-10-11", true)).toBe(true);
    expect(isOverdue(inv(), "2026-10-10", true)).toBe(false); // due day itself is fine
    expect(isOverdue(inv(), "2026-10-11", false)).toBe(false); // older invoice: balance already carried
    expect(isOverdue(inv({ status: "review" }), "2026-10-20", true)).toBe(false);
    expect(isOverdue(inv({ balance: 0, status: "paid" }), "2026-10-20", true)).toBe(false);
    expect(isOverdue(inv({ status: "partial", balance: 5000 }), "2026-10-20", true)).toBe(true);
    expect(displayStatus(inv({ status: "rejected" }), "2026-10-20", true)).toBe("overdue");
    expect(displayStatus(inv({ status: "partial" }), "2026-10-05", true)).toBe("partial");
  });
});

describe("payments · balance helpers", () => {
  it("to pay / advance", () => {
    expect(toPay({ balance: 20000 })).toBe(20000);
    expect(toPay({ balance: -10000 })).toBe(0);
    expect(advanceOf({ balance: -10000 })).toBe(10000);
    expect(advanceOf({ balance: 5 })).toBe(0);
  });

  it("totals and collected percent", () => {
    const t = totals([
      { amount: 60000, paid_amount: 60000, balance: 0 },
      { amount: 60000, paid_amount: 40000, balance: 20000 },
      { amount: 65000, paid_amount: 75000, balance: -10000 },
    ]);
    expect(t).toEqual({ accrued: 185000, paid: 175000, debt: 20000, count: 3 });
    expect(collectedPercent(t)).toBe(95);
    expect(collectedPercent({ accrued: 100, paid: 250 })).toBe(100);
    expect(collectedPercent({ accrued: 0, paid: 0 })).toBe(0);
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
    expect(paymentPurpose("Оплата за детский сад", "Ахметов Алихан", "Октябрь 2026")).toBe("Оплата за детский сад, Ахметов Алихан, Октябрь 2026");
    expect(paymentPurpose("", "Ахметов Алихан", "Октябрь 2026")).toBe("Ахметов Алихан, Октябрь 2026");
  });
});

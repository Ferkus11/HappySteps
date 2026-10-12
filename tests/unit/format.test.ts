import { describe, expect, it } from "vitest";
import { addDays, ageOn, formatDate, formatMoney, formatTime, isoWeekday, monthRange, todayIn } from "@/lib/format";

describe("format", () => {
  it("money in tenge", () => {
    expect(formatMoney(45000)).toBe("45 000 ₸");
    expect(formatMoney("1250000.4")).toBe("1 250 000 ₸");
    expect(formatMoney(0)).toBe("0 ₸");
  });
  it("dates as dd.mm.yyyy and 24h time in kindergarten tz", () => {
    expect(formatDate("2026-10-12")).toBe("12.10.2026");
    expect(formatDate(new Date("2026-10-12T20:30:00Z"))).toBe("13.10.2026"); // UTC+5
    expect(formatTime(new Date("2026-10-12T03:05:00Z"))).toBe("08:05");
  });
  it("today in Almaty", () => {
    expect(todayIn("Asia/Almaty", new Date("2026-10-12T19:30:00Z"))).toBe("2026-10-13");
    expect(todayIn("Asia/Almaty", new Date("2026-10-12T18:30:00Z"))).toBe("2026-10-12");
  });
  it("date arithmetic", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(ageOn("2021-10-13", "2026-10-12")).toBe(4);
    expect(ageOn("2021-10-12", "2026-10-12")).toBe(5);
    expect(isoWeekday("2026-10-12")).toBe(1);
    expect(isoWeekday("2026-10-18")).toBe(7);
    expect(monthRange("2026-02").days.length).toBe(28);
  });
});

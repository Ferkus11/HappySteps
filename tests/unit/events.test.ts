import { describe, expect, it } from "vitest";
import { isDay, isMonth, monthGrid, reminderDate, shiftMonth, timeRange } from "@/lib/events";

describe("events calendar helpers", () => {
  it("shiftMonth crosses year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("monthGrid starts on Monday and covers the whole month", () => {
    const oct = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(oct[0][0]).toBe("2026-09-28");
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(oct.flat()).toContain("2026-10-31");
    expect(oct[oct.length - 1][6]).toBe("2026-11-01");
    const feb = monthGrid("2027-02"); // 1 Feb 2027 is a Monday, 28 days → exactly 4 weeks
    expect(feb.length).toBe(4);
    expect(feb[0][0]).toBe("2027-02-01");
  });

  it("validates month and day params", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isDay("2026-10-12")).toBe(true);
    expect(isDay("2026-1-2")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });

  it("timeRange", () => {
    expect(timeRange({ start_time: null, end_time: null })).toBeNull();
    expect(timeRange({ start_time: "10:00", end_time: null })).toBe("10:00");
    expect(timeRange({ start_time: "10:00", end_time: "11:30" })).toBe("10:00–11:30");
  });
});

describe("event reminder selection (cron)", () => {
  it("reminds about local tomorrow once quiet hours are over", () => {
    // 2026-10-12 03:00 UTC = 08:00 in Almaty (UTC+5)
    expect(reminderDate(new Date("2026-10-12T03:00:00Z"), "Asia/Almaty", "08:00")).toBe("2026-10-13");
    expect(reminderDate(new Date("2026-10-12T02:59:00Z"), "Asia/Almaty", "08:00")).toBeNull();
    expect(reminderDate(new Date("2026-10-12T18:30:00Z"), "Asia/Almaty", "08:00")).toBe("2026-10-13"); // 23:30 local
  });

  it("uses the kindergarten's time zone for 'tomorrow'", () => {
    // 2026-10-12 20:00 UTC: Almaty is already 13 Oct 01:00 (quiet), London is 12 Oct 21:00
    const now = new Date("2026-10-12T20:00:00Z");
    expect(reminderDate(now, "Asia/Almaty", "08:00")).toBeNull();
    expect(reminderDate(now, "Europe/London", "08:00")).toBe("2026-10-13");
    expect(reminderDate(new Date("2026-12-31T05:00:00Z"), "Asia/Almaty", "09:00")).toBe("2027-01-01");
  });
});

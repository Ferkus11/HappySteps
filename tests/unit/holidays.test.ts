import { describe, expect, it } from "vitest";
import { kzHolidays } from "@/lib/holidays-kz";

describe("KZ holidays", () => {
  it("contains Nauryz and Independence Day", () => {
    const dates = kzHolidays(2026).map((h) => h.date);
    expect(dates).toEqual(expect.arrayContaining(["2026-03-21", "2026-03-22", "2026-03-23", "2026-12-16", "2026-05-27"]));
  });
  it("moves weekend holidays to the next working day", () => {
    // 2026-03-21 and 03-22 are Sat/Sun → days off on 24 and 25 March (23rd is already a holiday).
    const dates = kzHolidays(2026).map((h) => h.date);
    expect(dates).toEqual(expect.arrayContaining(["2026-03-24", "2026-03-25"]));
    // Orthodox Christmas on a weekend is not transferred (2027-01-07 is a Thursday; 2029-01-07 is Sunday).
    expect(kzHolidays(2029).filter((h) => h.name.ru.includes("Рождество")).length).toBe(1);
    expect(kzHolidays(2029).some((h) => h.name.ru.includes("перенос: Рождество"))).toBe(false);
  });
});

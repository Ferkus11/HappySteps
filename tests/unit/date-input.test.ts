import { describe, expect, it } from "vitest";
import { displayToIso, isIsoDate, isoToDisplay, maskDate, monthGrid, shiftIsoDay, shiftIsoMonth } from "@/lib/date-input";
import { loadMessages } from "@/messages";

describe("date field: dd.mm.yyyy text ↔ ISO value", () => {
  it("adds the dots while typing and keeps backspace working", () => {
    expect(maskDate("1")).toBe("1");
    expect(maskDate("15")).toBe("15");
    expect(maskDate("151")).toBe("15.1");
    expect(maskDate("1510")).toBe("15.10");
    expect(maskDate("15102026")).toBe("15.10.2026");
    expect(maskDate("15.10.20261")).toBe("15.10.2026");
    expect(maskDate("15/10/2026")).toBe("15.10.2026");
  });
  it("accepts a pasted ISO date", () => {
    expect(maskDate("2026-10-15")).toBe("15.10.2026");
    expect(maskDate(" 2021-06-01 ")).toBe("01.06.2021");
  });
  it("converts only complete, real dates", () => {
    expect(displayToIso("15.10.2026")).toBe("2026-10-15");
    expect(displayToIso("15.10.20")).toBe("");
    expect(displayToIso("30.02.2026")).toBe("");
    expect(displayToIso("29.02.2028")).toBe("2028-02-29");
    expect(isoToDisplay("2026-10-12")).toBe("12.10.2026");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay(null)).toBe("");
    expect(isIsoDate("2026-13-01")).toBe(false);
  });
  it("builds Monday-first month grids and shifts dates", () => {
    const oct = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(oct[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(oct.flat().filter(Boolean)).toHaveLength(31);
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(shiftIsoMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftIsoMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftIsoDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftIsoDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("date field texts come from the translation files", async () => {
  const ru = (await loadMessages("ru")).common as { dateField: Record<string, unknown> };
  const kk = (await loadMessages("kk")).common as { dateField: Record<string, unknown> };
  it("has a localized mask and Kazakh month names", () => {
    expect(ru.dateField.placeholder).toBe("дд.мм.гггг");
    expect(kk.dateField.placeholder).toBe("кк.аа.жжжж");
    expect((kk.dateField.months as Record<string, string>)["10"]).toBe("Қазан");
  });
});

describe("kk: download is «жүктеп алу», upload is «жүктеу»", async () => {
  const kk = await loadMessages("kk");
  const get = (ns: keyof typeof kk, key: string) => (kk[ns] as Record<string, string>)[key];
  it("download buttons", () => {
    expect(get("analytics", "export")).toBe(".xlsx жүктеп алу");
    expect(get("analytics", "exportShort")).toBe("Жүктеп алу");
    expect(get("attendance", "exportXlsx")).toBe(".xlsx жүктеп алу");
    expect(get("waitlist", "downloadQr")).toBe("QR-кодты жүктеп алу");
    expect(get("payments", "uploadReceipt")).toBe("Түбіртекті жүктеу");
  });
});

import { describe, expect, it } from "vitest";
import { ageFits, confirmOutcome, groupSchedule, normalizeSchedule, requestOutcome, scheduleValid, sortCatalog, statusTone } from "@/lib/clubs";

describe("clubs · schedule", () => {
  it("validates like SQL club_schedule_valid", () => {
    expect(scheduleValid([])).toBe(true);
    expect(scheduleValid([{ day: 1, start: "09:00", end: "09:45" }])).toBe(true);
    expect(scheduleValid([{ day: 0, start: "09:00", end: "09:45" }])).toBe(false);
    expect(scheduleValid([{ day: 8, start: "09:00", end: "09:45" }])).toBe(false);
    expect(scheduleValid([{ day: 2, start: "10:00", end: "09:00" }])).toBe(false);
    expect(scheduleValid([{ day: 2, start: "10:00", end: "10:00" }])).toBe(false);
    expect(scheduleValid([{ day: 2, start: "24:00", end: "24:30" }])).toBe(false);
    expect(scheduleValid([{ day: 2, start: "9:00", end: "10:00" }])).toBe(false);
    expect(scheduleValid(Array.from({ length: 15 }, () => ({ day: 1, start: "09:00", end: "10:00" })))).toBe(false);
  });

  it("sorts, de-duplicates and groups days with the same time", () => {
    const s = [
      { day: 4, start: "16:00", end: "16:45" },
      { day: 2, start: "16:00", end: "16:45" },
      { day: 2, start: "16:00", end: "16:45" },
      { day: 6, start: "10:00", end: "11:00" },
    ];
    expect(normalizeSchedule(s)).toHaveLength(3);
    expect(groupSchedule(s)).toEqual([
      { days: [2, 4], start: "16:00", end: "16:45" },
      { days: [6], start: "10:00", end: "11:00" },
    ]);
  });
});

describe("clubs · places and queue (mirrors SQL)", () => {
  it("age range is inclusive in full years", () => {
    const c = { age_from: 4, age_to: 6 };
    expect([3, 4, 5, 6, 7].map((a) => ageFits(c, a))).toEqual([false, true, true, true, false]);
  });

  it("a new request goes to the queue when the queue already takes every free place", () => {
    expect(requestOutcome({ free: 2, queued: 0 })).toBe("requested");
    expect(requestOutcome({ free: 1, queued: 1 })).toBe("queued");
    expect(requestOutcome({ free: 0, queued: 0 })).toBe("queued");
  });

  it("confirming: requests respect the queue; queued children only in order", () => {
    expect(confirmOutcome({ status: "requested" }, { free: 1, queued: 0 })).toBe("active");
    expect(confirmOutcome({ status: "requested" }, { free: 1, queued: 1 })).toBe("queued");
    expect(confirmOutcome({ status: "queued", position: 1 }, { free: 0, queued: 2 })).toBe("full");
    expect(confirmOutcome({ status: "queued", position: 1 }, { free: 1, queued: 2 })).toBe("active");
    expect(confirmOutcome({ status: "queued", position: 2 }, { free: 1, queued: 2 })).toBe("order");
    expect(confirmOutcome({ status: "queued", position: 2 }, { free: 2, queued: 2 })).toBe("active");
    expect(confirmOutcome({ status: "active" }, { free: 2, queued: 0 })).toBe("closed");
  });

  it("status tones: red only for exclusion", () => {
    expect(statusTone("active")).toBe("success");
    expect(statusTone("queued")).toBe("warning");
    expect(statusTone("excluded")).toBe("danger");
    expect(statusTone("rejected")).toBe("neutral");
  });

  it("catalog: own clubs first, then alphabetical", () => {
    const list = [{ id: "a", name: "Танцы" }, { id: "b", name: "Английский" }, { id: "c", name: "Шахматы" }];
    expect(sortCatalog(list, new Set(["c"])).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

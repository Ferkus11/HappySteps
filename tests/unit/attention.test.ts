import { describe, expect, it } from "vitest";
import { attentionItems, minutesOf, reminderPassed, unmarkedGroups } from "@/lib/attention";

const zero = { unmarkedGroups: 0, receipts: 0, clubRequests: 0, clubQueue: 0, documents: 0, waitlist: 0 };

describe("«Требует внимания»", () => {
  it("is empty when everything is zero (→ «Всё в порядке»)", () => {
    expect(attentionItems(zero)).toEqual([]);
    expect(attentionItems({ ...zero, receipts: null })).toEqual([]);
  });

  it("keeps only non-zero lines in a fixed order with links to the sections", () => {
    const items = attentionItems({ ...zero, waitlist: 2, receipts: 3, documents: 1, unmarkedGroups: 2 });
    expect(items.map((i) => [i.kind, i.count, i.href])).toEqual([
      ["unmarkedGroups", 2, "/attendance"],
      ["receipts", 3, "/payments"],
      ["documents", 1, "/documents?tab=staff&filter=expiring"],
      ["waitlist", 2, "/waitlist"],
    ]);
  });

  it("links straight to the group when exactly one is unmarked", () => {
    expect(attentionItems({ ...zero, unmarkedGroups: 1, unmarkedGroupId: "g1" })[0].href).toBe("/attendance?group=g1");
    expect(attentionItems({ ...zero, unmarkedGroups: 2, unmarkedGroupId: "g1" })[0].href).toBe("/attendance");
  });

  it("club requests and freed places are separate lines", () => {
    expect(attentionItems({ ...zero, clubRequests: 1, clubQueue: 2 }).map((i) => i.kind)).toEqual(["clubRequests", "clubQueue"]);
  });

  it("hides receipts for roles without payments (null)", () => {
    expect(attentionItems({ ...zero, receipts: null, waitlist: 1 }).map((i) => i.kind)).toEqual(["waitlist"]);
  });
});

describe("reminder time", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(minutesOf("10:00")).toBe(600);
    expect(minutesOf("09:30:00")).toBe(570);
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("")).toBeNull();
  });

  it("counts unmarked groups only at or after the reminder", () => {
    expect(reminderPassed("09:59", "10:00:00")).toBe(false);
    expect(reminderPassed("10:00", "10:00:00")).toBe(true);
    expect(reminderPassed("00:00", "00:00")).toBe(true);
    expect(reminderPassed("10:30", null)).toBe(true); // default 10:00
    expect(reminderPassed("bad", "10:00")).toBe(false);
  });

  it("a group is unmarked when it has active children without a mark or report", () => {
    const rows = [
      { group_id: "a", active: 3, unmarked: 0 },
      { group_id: "b", active: 2, unmarked: 1 },
      { group_id: "c", active: 0, unmarked: 0 },
    ];
    expect(unmarkedGroups(rows).map((r) => r.group_id)).toEqual(["b"]);
  });
});

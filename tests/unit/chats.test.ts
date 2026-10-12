import { describe, expect, it } from "vitest";
import { deletedKind, inQuietHours, localDay, localTime, mergeMessages, sortChats, type ChatMessage } from "@/lib/chats-logic";

describe("chats · quiet hours (composer hint)", () => {
  it("overnight window 21:00–08:00", () => {
    expect(inQuietHours("20:59", "21:00", "08:00")).toBe(false);
    expect(inQuietHours("21:00", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("00:30", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("07:59", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("08:00", "21:00", "08:00")).toBe(false);
    expect(inQuietHours("13:00", "21:00", "08:00")).toBe(false);
  });
  it("daytime window and an empty window", () => {
    expect(inQuietHours("14:00", "13:00", "15:00")).toBe(true);
    expect(inQuietHours("15:00", "13:00", "15:00")).toBe(false);
    expect(inQuietHours("10:00", "10:00", "10:00")).toBe(false);
  });
  it("local time is taken in the garden's time zone", () => {
    const at = new Date("2026-10-14T16:30:00Z"); // 21:30 in Almaty (UTC+5)
    expect(localTime("Asia/Almaty", at)).toBe("21:30");
    expect(inQuietHours(localTime("Asia/Almaty", at), "21:00", "08:00")).toBe(true);
    expect(localDay("2026-10-14T19:30:00Z", "Asia/Almaty")).toBe("2026-10-15");
  });
});

const msg = (id: string, created_at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, chat_id: "c", author_id: "a", body: id, reply_to: null, created_at, edited_at: null, deleted_at: null, deleted_by: null, files: [], ...extra,
});

describe("chats · list and messages", () => {
  it("group chats first, then the staff chat, then direct chats by last activity", () => {
    const base = { group_name: null, group_sort: null, created_at: "2026-10-01T00:00:00Z" };
    const rows = [
      { ...base, id: "d1", kind: "direct" as const, last_at: "2026-10-10T10:00:00Z" },
      { ...base, id: "s", kind: "staff" as const, last_at: "2026-10-12T10:00:00Z" },
      { ...base, id: "g2", kind: "group" as const, group_sort: 2, group_name: "Звёздочки", last_at: null },
      { ...base, id: "d2", kind: "direct" as const, last_at: "2026-10-11T10:00:00+05:00" },
      { ...base, id: "g1", kind: "group" as const, group_sort: 1, group_name: "Солнышко", last_at: null },
    ];
    expect(sortChats(rows).map((r) => r.id)).toEqual(["g1", "g2", "s", "d2", "d1"]);
  });

  it("merges realtime, optimistic and server copies by id, ordered by instant", () => {
    const a = msg("a", "2026-10-12T10:00:00.000Z");
    const b = msg("b", "2026-10-12T15:00:01+05:00"); // = 10:00:01Z
    const b2 = { ...b, body: "edited", files: [{ id: "f", message_id: "b", kind: "pdf" as const, name: "x.pdf", size: 1, mime: "application/pdf" }] };
    const merged = mergeMessages([b, a], [b2]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(merged[1].body).toBe("edited");
    expect(merged[1].files).toHaveLength(1);
  });

  it("deleted placeholder: by the author or by the administration", () => {
    expect(deletedKind(msg("x", "2026-10-12T10:00:00Z"))).toBe("none");
    expect(deletedKind(msg("x", "2026-10-12T10:00:00Z", { deleted_at: "2026-10-12T11:00:00Z", deleted_by: "a" }))).toBe("self");
    expect(deletedKind(msg("x", "2026-10-12T10:00:00Z", { deleted_at: "2026-10-12T11:00:00Z", deleted_by: "head" }))).toBe("admin");
  });
});

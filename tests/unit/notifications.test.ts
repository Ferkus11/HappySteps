import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ru from "@/messages/ru/notifications.json";
import kk from "@/messages/kk/notifications.json";
import { renderNotification } from "@/lib/notification-render";
import { deferredByQuietHours, inQuietHours, laterOf, quietHoursEnd } from "@/lib/quiet-hours";
import { safeAppPath, safeNextPath } from "@/lib/safe-path";
import { filterByPreferences, NOTIFICATION_AUDIENCE, NOTIFICATION_TYPES, typesForRoles } from "@/lib/notification-types";

vi.mock("server-only", () => ({}));
const { buildPush, chatIdOf, isAllowedEndpoint, runLimited, PUSH_CHAT_PREVIEW } = await import("@/lib/push");

describe("notifications · rendering in the reader's language", () => {
  it("payments: month YYYY-MM becomes a month name in ru and kk", () => {
    expect(renderNotification(ru, "ru", "receipt.accepted", { month: "2026-10", amount: "45 000 ₸" })).toEqual({ title: "Оплата подтверждена", body: "Октябрь 2026: 45 000 ₸" });
    expect(renderNotification(kk, "kk", "receipt.accepted", { month: "2026-10", amount: "45 000 ₸" })).toEqual({ title: "Төлем расталды", body: "2026 ж. Қазан: 45 000 ₸" });
    expect(renderNotification(ru, "ru", "receipt.rejected", { month: "2026-01", reason: "Не та сумма" }).body).toBe("Январь 2026: Не та сумма. Загрузите чек заново.");
  });

  it("raw select values (absence reason, club status) are translated", () => {
    const p = { child: "Алихан", reason: "sick", period: "14.10.2026" };
    expect(renderNotification(ru, "ru", "absence.reported", p)).toEqual({ title: "Алихан не придёт", body: "Болеет: 14.10.2026" });
    expect(renderNotification(kk, "kk", "absence.reported", p)).toEqual({ title: "Алихан келмейді", body: "Ауырып тұр: 14.10.2026" });
    expect(renderNotification(ru, "ru", "club.decision", { club: "Шахматы", child: "Миша", status: "queued" }).body).toBe("Миша: мест нет, ребёнок в очереди");
    expect(renderNotification(kk, "kk", "club.decision", { club: "Шахматы", child: "Миша", status: "left" }).body).toBe("Миша: мәртебе өзгерді");
    expect(renderNotification(ru, "ru", "club.request", { club: "Танцы", child: "Миша", status: "queued" }).title).toBe("Заявка в кружок — в очередь");
  });

  it("every call-site parameter set renders without leftovers", () => {
    expect(renderNotification(ru, "ru", "message.new", { from: "Иванова · Солнышко", text: "Добрый день" })).toEqual({ title: "Новое сообщение", body: "Иванова · Солнышко: Добрый день" });
    expect(renderNotification(ru, "ru", "event.reminder", { title: "Утренник", date: "15.10.2026", time: "", place: "Зал" })).toEqual({ title: "Завтра: Утренник", body: "15.10.2026 · Зал" });
    expect(renderNotification(kk, "kk", "attendance.not_marked", { group: "Солнышко" }).body).toBe("«Солнышко» тобы бүгін әлі белгіленбеген");
    expect(renderNotification(ru, "ru", "worktime.auto_closed", { date: "13.10.2026", time: "18:00" }).body).toBe("13.10.2026: время окончания — 18:00");
  });

  it("missing params, nulls and unknown types never break the centre", () => {
    expect(renderNotification(ru, "ru", "message.new", { from: "Иванова" })).toEqual({ title: "Новое сообщение", body: "Иванова" });
    expect(renderNotification(ru, "ru", "receipt.rejected", { month: null, reason: null }).body).toBe("Загрузите чек заново.");
    expect(renderNotification(ru, "ru", "something.else", {})).toEqual({ title: "Уведомление", body: "" });
    expect(renderNotification(kk, "kk", "announcement.new", null)).toEqual({ title: "Жаңа жарияланым", body: "" });
  });

  it("every type has a title, body and a preference label in both languages", () => {
    for (const m of [ru, kk]) {
      for (const t of NOTIFICATION_TYPES) {
        expect(m.types[t], t).toBeTruthy();
        expect((m.prefs.types as Record<string, string>)[t], t).toBeTruthy();
      }
    }
  });
});

describe("notifications · quiet hours", () => {
  const tz = "Asia/Almaty"; // UTC+5
  it("defers to the end of an overnight window", () => {
    expect(quietHoursEnd(new Date("2026-10-13T17:30:00Z"), tz, "21:00", "08:00")?.toISOString()).toBe("2026-10-14T03:00:00.000Z"); // 22:30 local
    expect(quietHoursEnd(new Date("2026-10-13T02:00:00Z"), tz, "21:00", "08:00")?.toISOString()).toBe("2026-10-13T03:00:00.000Z"); // 07:00 local
    expect(quietHoursEnd(new Date("2026-10-13T16:00:00Z"), tz, "21:00", "08:00")?.toISOString()).toBe("2026-10-14T03:00:00.000Z"); // 21:00 sharp
  });
  it("sends at once outside quiet hours and when the window is empty", () => {
    expect(quietHoursEnd(new Date("2026-10-13T03:00:00Z"), tz, "21:00", "08:00")).toBeNull(); // 08:00 sharp
    expect(quietHoursEnd(new Date("2026-10-13T10:00:00Z"), tz, "21:00", "08:00")).toBeNull();
    expect(quietHoursEnd(new Date("2026-10-13T17:30:00Z"), tz, "00:00", "00:00")).toBeNull();
  });
  it("daytime window in another time zone", () => {
    expect(inQuietHours(new Date("2026-10-13T12:30:00Z"), "Europe/Moscow", "15:00", "16:00")).toBe(true); // 15:30 MSK
    expect(quietHoursEnd(new Date("2026-10-13T12:30:15Z"), "Europe/Moscow", "15:00", "16:00")?.toISOString()).toBe("2026-10-13T13:00:00.000Z");
  });
  it("ends at the local end time across a DST change (the night is 25 or 23 hours long)", () => {
    // Berlin, autumn: 25 Oct 2026 03:00 CEST → 02:00 CET. 22:00 CEST (20:00Z) → 08:00 CET = 07:00Z (11 h later, not 10).
    expect(quietHoursEnd(new Date("2026-10-24T20:00:00Z"), "Europe/Berlin", "21:00", "08:00")?.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    // spring: 29 Mar 2026 02:00 CET → 03:00 CEST. 22:00 CET (21:00Z) → 08:00 CEST = 06:00Z.
    expect(quietHoursEnd(new Date("2026-03-28T21:00:00Z"), "Europe/Berlin", "21:00", "08:00")?.toISOString()).toBe("2026-03-29T06:00:00.000Z");
    // after midnight on the change day
    expect(quietHoursEnd(new Date("2026-10-25T00:30:00Z"), "Europe/Berlin", "21:00", "08:00")?.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    // month and year boundaries
    expect(quietHoursEnd(new Date("2026-12-31T18:00:00Z"), "Asia/Almaty", "21:00", "08:00")?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
  it("the later deferral wins", () => {
    expect(laterOf(null, null)).toBeNull();
    expect(laterOf("2026-10-14T03:00:00Z", null)).toBe("2026-10-14T03:00:00Z");
    expect(laterOf("2026-10-14T03:00:00Z", "2026-10-14T04:00:00Z")).toBe("2026-10-14T04:00:00Z");
  });
});

describe("notifications · quiet-hours policy", () => {
  it("time-critical types are never deferred", () => {
    expect(deferredByQuietHours("absence.reported")).toBe(false);
    expect(deferredByQuietHours("attendance.not_marked")).toBe(false);
  });
  it("an announcement waits unless it is important", () => {
    expect(deferredByQuietHours("announcement.new")).toBe(true);
    expect(deferredByQuietHours("announcement.new", { important: false })).toBe(true);
    expect(deferredByQuietHours("announcement.new", { important: true })).toBe(false);
    // the reminder about an unread one is routine even for an important announcement
    expect(deferredByQuietHours("announcement.reminder", { important: true })).toBe(true);
  });
  it("chat messages follow the chat module's own rule (garden quiet hours are not added)", () => {
    expect(deferredByQuietHours("message.new")).toBe(false);
  });
  it("every other type is routine and waits for the morning", () => {
    const immediate = new Set(["absence.reported", "attendance.not_marked", "message.new"]);
    for (const type of NOTIFICATION_TYPES) expect(deferredByQuietHours(type), type).toBe(!immediate.has(type));
  });
});

describe("notifications · preferences and audiences", () => {
  it("disabled users are dropped", () => {
    expect(filterByPreferences(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
    expect(filterByPreferences(["a"], new Set())).toEqual(["a"]);
  });
  it("only the types of the person's roles are offered", () => {
    expect(typesForRoles(["parent"])).toEqual(["message.new", "announcement.new", "announcement.reminder", "event.reminder", "receipt.accepted", "receipt.rejected", "club.decision"]);
    expect(typesForRoles(["accountant"])).toContain("receipt.new");
    expect(typesForRoles(["accountant"])).not.toContain("waitlist.new");
    expect(typesForRoles(["teacher", "parent"])).toEqual(expect.arrayContaining(["absence.reported", "attendance.not_marked", "club.decision"]));
    expect(typesForRoles([])).toEqual([]);
    expect(Object.keys(NOTIFICATION_AUDIENCE).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
});

describe("push · payload and endpoints", () => {
  const chat = "0c6f3a52-61b9-4a51-9d8c-2f0d1e7a9b10";
  it("chat messages collapse per chat (tag + topic) and go out urgently", () => {
    const p = buildPush({ id: "n1", user_id: "u", kindergarten_id: "k", type: "message.new", params: { from: "Анна", text: "Привет" }, url: `/chats/${chat}` }, "kk");
    expect(p.payload).toEqual({ id: "n1", title: "Жаңа хабарлама", body: "Анна: Привет", url: "/notifications/n1/open", tag: `chat:${chat}` });
    expect(p.urgency).toBe("high");
    expect(p.topic).toBe(chat.replace(/-/g, ""));
    expect(p.topic).toHaveLength(32);
  });
  it("other types are not collapsed", () => {
    const p = buildPush({ id: "n2", user_id: "u", kindergarten_id: "k", type: "receipt.accepted", params: { month: "2026-10", amount: "1 ₸" }, url: "/payments" }, "ru");
    expect(p.payload.tag).toBe("n:n2");
    expect(p.payload.body).toBe("Октябрь 2026: 1 ₸");
    expect(p.urgency).toBe("normal");
    expect(p.topic).toBeUndefined();
    expect(chatIdOf("/chats/x")).toBeNull();
  });
  it("lock screen: an absence shows the child and the period, not the reason (the bell keeps it)", () => {
    const row = { id: "n3", user_id: "u", kindergarten_id: "k", type: "absence.reported", params: { child: "Алихан", reason: "sick", period: "14.10.2026" }, url: "/attendance" };
    expect(buildPush(row, "ru").payload).toMatchObject({ title: "Алихан не придёт", body: "14.10.2026" });
    expect(buildPush(row, "kk").payload).toMatchObject({ title: "Алихан келмейді", body: "14.10.2026" });
    expect(JSON.stringify(buildPush(row, "ru").payload)).not.toMatch(/Болеет|sick/);
    expect(renderNotification(ru, "ru", "absence.reported", row.params).body).toBe("Болеет: 14.10.2026");
  });
  it("lock screen: a chat message shows the sender and the first ~100 characters", () => {
    const text = "а".repeat(120);
    const p = buildPush({ id: "n4", user_id: "u", kindergarten_id: "k", type: "message.new", params: { from: "Анна", text }, url: `/chats/${chat}` }, "ru");
    expect(p.payload.body).toBe(`Анна: ${"а".repeat(PUSH_CHAT_PREVIEW - 1)}…`);
    const short = buildPush({ id: "n5", user_id: "u", kindergarten_id: "k", type: "message.new", params: { from: "Анна", text: "Привет" }, url: `/chats/${chat}` }, "ru");
    expect(short.payload.body).toBe("Анна: Привет");
  });
  it("a deleted chat message renders neutrally in the bell and the push", () => {
    const params = { from: "Анна", message_id: "m1", deleted: "yes" };
    expect(renderNotification(ru, "ru", "message.new", params)).toEqual({ title: "Новое сообщение", body: "Сообщение удалено" });
    expect(renderNotification(kk, "kk", "message.new", params)).toEqual({ title: "Жаңа хабарлама", body: "Хабарлама жойылды" });
    expect(buildPush({ id: "n6", user_id: "u", kindergarten_id: "k", type: "message.new", params, url: `/chats/${chat}` }, "ru").payload.body).toBe("Сообщение удалено");
    // a live message is unchanged
    expect(renderNotification(ru, "ru", "message.new", { from: "Анна", text: "Привет", message_id: "m2" }).body).toBe("Анна: Привет");
  });
  it("sends with at most N requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    const tasks = Array.from({ length: 45 }, (_, i) => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1 + (i % 3)));
      inFlight--;
      done.push(i);
    });
    await runLimited(tasks, 20);
    expect(done).toHaveLength(45);
    expect(peak).toBe(20);
    await runLimited([], 20);
  });
  it("only known push services are allowed (no SSRF); loopback only with the local flag", () => {
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedEndpoint("https://db5p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isAllowedEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedEndpoint("https://evil.com/fcm.googleapis.com")).toBe(false);
    expect(isAllowedEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    const prev = process.env.PUSH_ALLOW_LOCAL_ENDPOINTS;
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = "";
    expect(isAllowedEndpoint("http://127.0.0.1:9999/push")).toBe(false);
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = "1";
    expect(isAllowedEndpoint("http://127.0.0.1:9999/push")).toBe(true);
    expect(isAllowedEndpoint("http://10.0.0.1/push")).toBe(false);
    process.env.PUSH_ALLOW_LOCAL_ENDPOINTS = prev;
  });
});

describe("service worker · sw-push.js", () => {
  function worker(clients: { url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; options: Record<string, unknown> }[] = [];
    const opened: string[] = [];
    const self = {
      location: { origin: "https://app.example.kz" },
      addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
      clients: { matchAll: async () => clients, openWindow: async (u: string) => void opened.push(u) },
    };
    vm.runInNewContext(readFileSync(resolve(__dirname, "../../public/sw-push.js"), "utf8"), { self, URL });
    const fire = async (type: string, event: Record<string, unknown>) => {
      let wait: Promise<unknown> = Promise.resolve();
      handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) });
      await wait;
    };
    return { fire, shown, opened };
  }

  it("shows the payload with icon, badge, tag and the link", async () => {
    const w = worker();
    const payload = { id: "n1", title: "Жаңа хабарлама", body: "Анна: Привет", url: "/notifications/n1/open", tag: "chat:abc" };
    await w.fire("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Жаңа хабарлама");
    expect(w.shown[0].options).toMatchObject({ body: "Анна: Привет", icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "chat:abc", renotify: true, data: { url: "/notifications/n1/open", id: "n1" } });
  });

  it("ignores foreign links and broken payloads", async () => {
    const w = worker();
    await w.fire("push", { data: { json: () => ({ title: "X", url: "//evil.com/x" }), text: () => "" } });
    await w.fire("push", { data: { json: () => { throw new Error("not json"); }, text: () => "plain" } });
    expect((w.shown[0].options.data as { url: string }).url).toBe("/notifications");
    expect(w.shown[1].title).toBe("plain");
  });

  it("rejects //host and /\\host links (mirrors safeAppPath)", async () => {
    const w = worker();
    for (const url of ["//evil.com/x", "/\\evil.com/x", "https://evil.com/x", "", null]) {
      await w.fire("push", { data: { json: () => ({ title: "X", url }), text: () => "" } });
    }
    expect(w.shown.map((n) => (n.options.data as { url: string }).url)).toEqual(Array(5).fill("/notifications"));
    for (const url of ["//evil.com/x", "/\\evil.com/x", "/payments"]) expect(safeAppPath(url)).toBe(url === "/payments" ? url : null);
  });

  it("a click focuses an open window and navigates it, or opens a new one", async () => {
    const navigated: string[] = [];
    const client = { url: "https://app.example.kz/", focus: async () => client, navigate: async (u: string) => void navigated.push(u) };
    const close = () => {};
    const w1 = worker([client]);
    await w1.fire("notificationclick", { notification: { close, data: { url: "/notifications/n1/open" } } });
    expect(navigated).toEqual(["https://app.example.kz/notifications/n1/open"]);
    expect(w1.opened).toEqual([]);
    const w2 = worker();
    await w2.fire("notificationclick", { notification: { close, data: { url: "/payments" } } });
    expect(w2.opened).toEqual(["https://app.example.kz/payments"]);
  });
});

describe("login · next parameter", () => {
  it("accepts same-origin app paths only", () => {
    expect(safeNextPath("/notifications/0c6f3a52-61b9-4a51-9d8c-2f0d1e7a9b10/open")).toBe("/notifications/0c6f3a52-61b9-4a51-9d8c-2f0d1e7a9b10/open");
    expect(safeNextPath("/payments?month=2026-10#top")).toBe("/payments?month=2026-10#top");
    for (const bad of ["//evil.com", "/\\evil.com", "/\tevil", "https://evil.com", "javascript:alert(1)", "evil.com", "", "/login", "/login?next=/x", "/%2F%2Fevil.com/../x", null, 42, ["/x"]]) {
      const r = safeNextPath(bad);
      if (r !== null) expect(new URL(r, "https://app.test").origin, String(bad)).toBe("https://app.test");
      if (bad === "/login" || bad === "/login?next=/x" || bad === "//evil.com" || bad === "/\\evil.com" || bad === "https://evil.com") expect(r, String(bad)).toBeNull();
    }
    expect(safeNextPath("/" + "a".repeat(600))).toBeNull();
  });
});

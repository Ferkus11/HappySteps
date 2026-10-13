import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ru from "@/messages/ru/notifications.json";
import kk from "@/messages/kk/notifications.json";
import { renderNotification } from "@/lib/notification-render";
import { inQuietHours, laterOf, quietHoursEnd } from "@/lib/quiet-hours";
import { filterByPreferences, NOTIFICATION_AUDIENCE, NOTIFICATION_TYPES, typesForRoles } from "@/lib/notification-types";

vi.mock("server-only", () => ({}));
const { buildPush, chatIdOf, isAllowedEndpoint } = await import("@/lib/push");

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
    expect(renderNotification(kk, "kk", "announcement.new", null)).toEqual({ title: "Жаңа хабарландыру", body: "" });
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
  it("the later deferral wins", () => {
    expect(laterOf(null, null)).toBeNull();
    expect(laterOf("2026-10-14T03:00:00Z", null)).toBe("2026-10-14T03:00:00Z");
    expect(laterOf("2026-10-14T03:00:00Z", "2026-10-14T04:00:00Z")).toBe("2026-10-14T04:00:00Z");
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
    expect(w.shown[0].options).toMatchObject({ body: "Анна: Привет", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: "chat:abc", renotify: true, data: { url: "/notifications/n1/open", id: "n1" } });
  });

  it("ignores foreign links and broken payloads", async () => {
    const w = worker();
    await w.fire("push", { data: { json: () => ({ title: "X", url: "//evil.com/x" }), text: () => "" } });
    await w.fire("push", { data: { json: () => { throw new Error("not json"); }, text: () => "plain" } });
    expect((w.shown[0].options.data as { url: string }).url).toBe("/notifications");
    expect(w.shown[1].title).toBe("plain");
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

/** Pure chat helpers shared by server and client code (SPEC §5.7). */

export const CHAT_TEXT_MAX = 4000;
export const CHAT_FILE_MAX = 15 * 1024 * 1024;
export const CHAT_PAGE = 60;
/** Accepted uploads → stored extension. HEIC is converted to JPEG in the browser before upload. */
export const CHAT_FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const CHAT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";

export type ChatKind = "group" | "staff" | "direct";

export interface ChatSummary {
  id: string;
  kind: ChatKind;
  group_id: string | null;
  group_name: string | null;
  group_color: string | null;
  group_sort: number | null;
  other_id: string | null;
  other_name: string | null;
  other_role: string | null;
  parents_can_write: boolean;
  can_write: boolean;
  last_id: string | null;
  last_body: string | null;
  last_author_id: string | null;
  last_author_name: string | null;
  last_at: string | null;
  last_deleted: boolean | null;
  last_file: "photo" | "pdf" | null;
  unread: number;
  created_at: string;
}

export interface ChatFile {
  id: string;
  message_id: string;
  kind: "photo" | "pdf";
  name: string;
  size: number;
  mime: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  author_id: string | null;
  body: string;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  files: ChatFile[];
}

export interface ChatPerson {
  user_id: string;
  full_name: string;
  chat_role: string | null;
  is_member: boolean;
}

/** "HH:MM" in [start, end) — the window may wrap over midnight (21:00–08:00). Equal bounds = no quiet hours. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  const m = (s: string) => {
    const [h, mm] = s.split(":").map(Number);
    return h * 60 + mm;
  };
  const t = m(time);
  const a = m(start);
  const b = m(end);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Local "HH:MM" of a moment in a time zone. */
export function localTime(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** YYYY-MM-DD of a moment in a time zone (day separators). */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Group chats first (in group order), then the staff chat, then direct chats by last activity. */
export function sortChats<T extends Pick<ChatSummary, "kind" | "group_sort" | "group_name" | "last_at" | "created_at">>(rows: T[]): T[] {
  const rank = { group: 0, staff: 1, direct: 2 } as const;
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    if (a.kind === "group") return (a.group_sort ?? 0) - (b.group_sort ?? 0) || (a.group_name ?? "").localeCompare(b.group_name ?? "");
    return Date.parse(b.last_at ?? b.created_at) - Date.parse(a.last_at ?? a.created_at);
  });
}

/** Messages in display order, de-duplicated by id (realtime + optimistic + refetch). */
export function mergeMessages(...lists: ChatMessage[][]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) map.set(m.id, { ...map.get(m.id), ...m, files: m.files ?? map.get(m.id)?.files ?? [] });
  // Timestamps may come in different ISO spellings (PostgREST vs Realtime) — compare as instants.
  return [...map.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

/** Authors may edit a message for this long after sending it (enforced in SQL, tg_message_guard). */
export const CHAT_EDIT_WINDOW_MS = 15 * 60_000;

/** Is the message still editable at `nowMs`? (a little margin so a save started in time still passes) */
export function withinEditWindow(createdAt: string, nowMs: number): boolean {
  return nowMs - Date.parse(createdAt) < CHAT_EDIT_WINDOW_MS - 30_000;
}

/** Shown instead of a removed message: by the author or by the administration (moderation). */
export function deletedKind(m: Pick<ChatMessage, "deleted_at" | "deleted_by" | "author_id">): "none" | "self" | "admin" {
  if (!m.deleted_at) return "none";
  return m.deleted_by && m.deleted_by !== m.author_id ? "admin" : "self";
}

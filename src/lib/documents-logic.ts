/**
 * Documents (SPEC §5.8) — constants and pure helpers shared by server code, client components and unit tests.
 */

export const CHILD_CATEGORIES = ["medical", "vaccination", "applications", "other"] as const;
export type ChildCategory = (typeof CHILD_CATEGORIES)[number];

export const STAFF_DOC_TYPES = ["med_book", "no_criminal_record", "contract", "other"] as const;
export type StaffDocType = (typeof STAFF_DOC_TYPES)[number];

export const CHILD_BUCKET = "child-documents";
export const STAFF_BUCKET = "staff-documents";

export const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;
/** Days before expiry when a document counts as "expiring" (dashboard, badges, first reminder). */
export const EXPIRY_WINDOW_DAYS = 30;

/** Types the server stores (HEIC is converted to JPEG in the browser before upload). */
export const DOCUMENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** File input `accept`: photos (incl. HEIC from iPhones) and PDF; on phones it offers the camera too. */
export const DOCUMENT_ACCEPT = "image/*,application/pdf,.heic,.heif";

export function isHeic(file: { type: string; name: string }): boolean {
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/**
 * Real file type from the first bytes (the browser-provided type is not trusted):
 * JPEG FF D8 FF, PNG 89 50 4E 47, PDF "%PDF", WEBP "RIFF....WEBP". Null when it is none of them.
 */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Whole days from `today` to `date` (both ISO yyyy-mm-dd). Negative when `date` is in the past. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type ExpiryState = { kind: "none" } | { kind: "ok"; days: number } | { kind: "soon"; days: number } | { kind: "expired"; days: number };

/** Badge state: expired (date passed), soon (0…30 days left), ok, or none (no expiry date). */
export function expiryState(expiresOn: string | null | undefined, today: string): ExpiryState {
  if (!expiresOn) return { kind: "none" };
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { kind: "expired", days: -days };
  if (days <= EXPIRY_WINDOW_DAYS) return { kind: "soon", days };
  return { kind: "ok", days };
}

/**
 * Reminder threshold for a number of days left — mirrors SQL `document_expiry_due`:
 * 8–30 days → 30, 0–7 days → 7, otherwise none.
 */
export function reminderThreshold(daysLeft: number): 30 | 7 | null {
  if (daysLeft >= 0 && daysLeft <= 7) return 7;
  if (daysLeft >= 8 && daysLeft <= 30) return 30;
  return null;
}

/** Title fallback from a file name: without extension, trimmed to 200 chars. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim().slice(0, 200);
}

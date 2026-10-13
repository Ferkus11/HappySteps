/** Upload limits shared by server code and client components (documents, chats and receipts keep theirs in their own logic files). */

export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Child photo, club photo. */
export const PHOTO_MAX = 5 * 1024 * 1024;
/** Kindergarten logo. */
export const LOGO_MAX = 2 * 1024 * 1024;

export const ANNOUNCEMENT_FILE_MAX = 15 * 1024 * 1024;
export const ANNOUNCEMENT_FILE_TYPES: Record<string, string> = { ...PHOTO_TYPES, "application/pdf": "pdf" };

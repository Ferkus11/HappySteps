/**
 * Direct uploads (D-035) — the pure part shared by server code, the browser helper and tests.
 *
 * File bytes never pass through a server action (Vercel caps a function request body at 4.5 MB):
 *  1. a "prepare" action checks permissions, validates the declared size/type against the constants below,
 *     picks the object path itself and returns a Storage signed upload token plus an upload *ticket*
 *     (HMAC-signed: kind, path, user, kindergarten, target entity, expiry);
 *  2. the browser PUTs the file to Storage with that token;
 *  3. a "commit" action re-checks permissions, verifies the ticket (so the client can never choose or swap
 *     the path), reads the object's real size/type from Storage and its first bytes — and removes the object
 *     if anything is off — then writes the rows exactly as before.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionError } from "@/lib/actions/result";
import { CHAT_FILE_MAX, CHAT_FILE_TYPES } from "@/lib/chats-logic";
import { CHILD_BUCKET, DOCUMENT_TYPES, MAX_DOCUMENT_SIZE, STAFF_BUCKET, sniffMime } from "@/lib/documents-logic";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/payments";
import { ANNOUNCEMENT_FILE_MAX, ANNOUNCEMENT_FILE_TYPES, LOGO_MAX, PHOTO_MAX, PHOTO_TYPES } from "@/lib/upload-limits";

export interface UploadSpec {
  bucket: string;
  /** Largest accepted object, bytes (the bucket's own `file_size_limit` matches it). */
  max: number;
  /** Accepted MIME type → stored extension. */
  types: Record<string, string>;
  /** Error key when the file is too large. */
  tooLarge: string;
}

export const UPLOAD_SPECS = {
  chat: { bucket: "chat-files", max: CHAT_FILE_MAX, types: CHAT_FILE_TYPES, tooLarge: "fileTooLarge" },
  announcement: { bucket: "announcements", max: ANNOUNCEMENT_FILE_MAX, types: ANNOUNCEMENT_FILE_TYPES, tooLarge: "fileTooLarge" },
  childDocument: { bucket: CHILD_BUCKET, max: MAX_DOCUMENT_SIZE, types: DOCUMENT_TYPES, tooLarge: "fileTooLarge" },
  staffDocument: { bucket: STAFF_BUCKET, max: MAX_DOCUMENT_SIZE, types: DOCUMENT_TYPES, tooLarge: "fileTooLarge" },
  receipt: { bucket: "receipts", max: RECEIPT_MAX_BYTES, types: RECEIPT_TYPES, tooLarge: "fileTooLarge" },
  childPhoto: { bucket: "child-photos", max: PHOTO_MAX, types: PHOTO_TYPES, tooLarge: "fileTooLarge" },
  clubPhoto: { bucket: "club-photos", max: PHOTO_MAX, types: PHOTO_TYPES, tooLarge: "photoTooLarge" },
  logo: { bucket: "kindergarten-assets", max: LOGO_MAX, types: PHOTO_TYPES, tooLarge: "fileTooLarge" },
} as const satisfies Record<string, UploadSpec>;

export type UploadKind = keyof typeof UPLOAD_SPECS;

/** What the browser says about the file before uploading it (checked again against the stored object). */
export interface DeclaredFile {
  name: string;
  size: number;
  mime: string;
}

/** Returned by a prepare action to the browser. */
export interface PreparedUpload {
  bucket: string;
  path: string;
  /** Storage signed upload token (single path). */
  token: string;
  /** Content type to upload with. */
  mime: string;
  /** Opaque, HMAC-signed ticket the commit action takes back. */
  ticket: string;
}

/** Validates the declared file against the kind's limits; returns the stored extension. */
export function checkDeclared(kind: UploadKind, d: DeclaredFile): string {
  const spec: UploadSpec = UPLOAD_SPECS[kind];
  if (!d || typeof d.size !== "number" || !Number.isFinite(d.size) || d.size <= 0) throw new ActionError("invalid");
  if (typeof d.name !== "string" || typeof d.mime !== "string") throw new ActionError("invalid");
  if (d.size > spec.max) throw new ActionError(spec.tooLarge);
  const ext = spec.types[d.mime];
  if (!ext) throw new ActionError("fileType");
  return ext;
}

/** Display name of the uploaded file (stored in rows, shown to people). */
export const cleanName = (name: string, ext: string) => (name.trim() || `file.${ext}`).slice(0, 200);

export interface UploadTicket {
  /** kind */
  k: UploadKind;
  /** object path inside the kind's bucket */
  p: string;
  /** uploader (user id) */
  u: string;
  /** kindergarten id */
  g: string;
  /** target entity the upload is for (chat, child, invoice, …) */
  t: string;
  /** declared file name */
  n: string;
  /** expiry, epoch ms */
  x: number;
}

/** Tickets live as long as Supabase signed upload URLs (2 hours). */
export const TICKET_TTL_MS = 2 * 60 * 60 * 1000;

const b64url = (b: Buffer) => b.toString("base64url");

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(`hs-upload-ticket:v1:${body}`).digest();
}

export function signTicket(secret: string, t: UploadTicket): string {
  const body = b64url(Buffer.from(JSON.stringify(t)));
  return `${body}.${b64url(mac(secret, body))}`;
}

/** The ticket if the signature is valid and it has not expired; otherwise null. */
export function readTicket(secret: string, token: unknown, now = Date.now()): UploadTicket | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadTicket;
    if (typeof t.x !== "number" || t.x < now) return null;
    if (!(t.k in UPLOAD_SPECS) || typeof t.p !== "string" || typeof t.u !== "string" || typeof t.g !== "string" || typeof t.t !== "string") return null;
    return { ...t, n: typeof t.n === "string" ? t.n : "" };
  } catch {
    return null;
  }
}

/** Storage operations the verification needs (service role on the server, a fake in unit tests). */
export interface StorageIo {
  /** Real size and content type of the stored object, or null when there is no object. */
  info(bucket: string, path: string): Promise<{ size: number; mime: string } | null>;
  /** First `n` bytes of the object (or fewer), or null when it cannot be read. */
  head(bucket: string, path: string, n: number): Promise<Uint8Array | null>;
  remove(bucket: string, path: string): Promise<void>;
}

/** StorageIo over a service-role client (`url`/`key`: the project URL and service role key for the ranged read). */
export function createStorageIo(service: SupabaseClient, url: string, key: string): StorageIo {
  return {
    async info(bucket, path) {
      const { data, error } = await service.storage.from(bucket).info(path);
      if (error || !data) return null;
      const meta = (data.metadata ?? {}) as Record<string, unknown>;
      const size = Number(data.size ?? meta.size ?? meta.contentLength);
      const mime = String(data.contentType ?? meta.mimetype ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      return Number.isFinite(size) ? { size, mime } : null;
    },
    async head(bucket, path, n) {
      const target = `${url}/storage/v1/object/authenticated/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
      // A ranged read: Storage answers 206 with just these bytes (a server ignoring Range sends the object, which
      // the bucket limit keeps at ≤ 15 MB).
      const res = await fetch(target, { headers: { apikey: key, authorization: `Bearer ${key}`, range: `bytes=0-${n - 1}` }, cache: "no-store" });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer()).slice(0, n);
    },
    async remove(bucket, path) {
      await service.storage.from(bucket).remove([path]);
    },
  };
}

export interface VerifiedUpload {
  bucket: string;
  path: string;
  name: string;
  size: number;
  mime: string;
  ext: string;
}

export interface UploadExpectation {
  kind: UploadKind;
  userId: string;
  kgId: string;
  /** The entity this commit is for — must be the one the upload was prepared for. */
  target: string;
  /** The folder the path must be in (always under the kindergarten's prefix). */
  prefix: string;
}

/**
 * Commit-side check. Rejects a forged/expired/foreign ticket (nothing is touched), then checks the stored
 * object: it must exist, be within the size limit and be an accepted type both by Storage metadata and by its
 * first bytes. A bad object is removed before the error is thrown.
 */
export async function verifyUpload(io: StorageIo, secret: string, ticket: unknown, want: UploadExpectation, now = Date.now()): Promise<VerifiedUpload> {
  const t = readTicket(secret, ticket, now);
  if (!t) throw new ActionError("uploadFailed");
  const spec: UploadSpec = UPLOAD_SPECS[want.kind];
  const kgPrefix = `${want.kgId}/`;
  if (t.k !== want.kind || t.u !== want.userId || t.g !== want.kgId || t.t !== want.target) throw new ActionError("forbidden");
  if (!want.prefix.startsWith(kgPrefix) || !t.p.startsWith(want.prefix) || t.p.includes("..") || t.p.includes("//")) throw new ActionError("forbidden");
  const ext = t.p.slice(t.p.lastIndexOf(".") + 1);

  const info = await io.info(spec.bucket, t.p);
  if (!info) throw new ActionError("uploadFailed");
  const reject = async (code: string): Promise<never> => {
    await io.remove(spec.bucket, t.p).catch(() => {});
    throw new ActionError(code);
  };
  if (!(info.size > 0)) return reject("invalid");
  if (info.size > spec.max) return reject(spec.tooLarge);
  const bytes = await io.head(spec.bucket, t.p, 16);
  const real = bytes ? sniffMime(bytes) : null;
  // Storage's content type, the real bytes and the extension picked at prepare time must all agree.
  if (!real || real !== info.mime || spec.types[real] !== ext) return reject("fileType");
  return { bucket: spec.bucket, path: t.p, name: cleanName(t.n, ext), size: info.size, mime: real, ext };
}

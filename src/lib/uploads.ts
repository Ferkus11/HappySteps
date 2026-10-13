import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { serverEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import {
  TICKET_TTL_MS,
  UPLOAD_SPECS,
  checkDeclared,
  createStorageIo,
  signTicket,
  verifyUpload,
  type PreparedUpload,
  type StorageIo,
  type UploadKind,
  type VerifiedUpload,
} from "@/lib/uploads-core";

export type { PreparedUpload, VerifiedUpload } from "@/lib/uploads-core";

const declaredSchema = z.object({
  name: z.string().max(1000),
  size: z.number().int().positive(),
  mime: z.string().max(200),
});

/** Ticket key: derived from the service role key (server-only secret), separate from any other use of it. */
function ticketSecret(): string {
  return createHash("sha256").update(`hs-upload-ticket|${serverEnv.serviceRoleKey}`).digest("hex");
}

interface Who {
  userId: string;
  kg: { id: string };
}

/**
 * Step A of a direct upload (D-035). Call it AFTER the action's own permission checks. Validates the declared
 * size/type, picks the object path (`path(ext)`, a fresh uuid inside `prefix`) and returns a signed upload
 * token for exactly that path plus the ticket the commit step takes back.
 */
export async function prepareUpload(
  kind: UploadKind,
  who: Who,
  opts: { target: string; prefix: string; file: unknown; path: (ext: string, id: string) => string },
): Promise<PreparedUpload> {
  const parsed = declaredSchema.safeParse(opts.file);
  if (!parsed.success) throw new ActionError("invalid");
  const ext = checkDeclared(kind, parsed.data);
  const path = opts.path(ext, randomUUID());
  if (!opts.prefix.startsWith(`${who.kg.id}/`) || !path.startsWith(opts.prefix) || path.includes("..")) throw new ActionError("forbidden");
  const { bucket } = UPLOAD_SPECS[kind];
  const { data, error } = await createServiceClient().storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("createSignedUploadUrl", error?.message);
    throw new ActionError("uploadFailed");
  }
  const ticket = signTicket(ticketSecret(), {
    k: kind,
    p: path,
    u: who.userId,
    g: who.kg.id,
    t: opts.target,
    n: parsed.data.name.slice(0, 200),
    x: Date.now() + TICKET_TTL_MS,
  });
  return { bucket, path, token: data.token, mime: parsed.data.mime, ticket };
}

/**
 * Step C (call it AFTER re-checking permissions): verifies the ticket and the stored object
 * (exists, size and real type within limits — otherwise it is removed) and returns its facts for the rows.
 */
export async function commitUpload(kind: UploadKind, who: Who, ticket: unknown, opts: { target: string; prefix: string }): Promise<VerifiedUpload> {
  return verifyUpload(storageIo(), ticketSecret(), ticket, { kind, userId: who.userId, kgId: who.kg.id, target: opts.target, prefix: opts.prefix });
}

/** Removes an object (e.g. when writing its row failed). */
export async function removeObject(bucket: string, path: string) {
  await createServiceClient().storage.from(bucket).remove([path]);
}

/** Service-role storage access used by the verification. */
export function storageIo(): StorageIo {
  return createStorageIo(createServiceClient(), serverEnv.supabaseUrl, serverEnv.serviceRoleKey);
}

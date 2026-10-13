"use client";

import type { ActionResult } from "@/lib/actions/result";
import { sniffMime } from "@/lib/documents-logic";
import { getBrowserClient } from "@/lib/supabase/client";
import type { DeclaredFile, PreparedUpload } from "@/lib/uploads-core";

/** Name, size and type of a picked file — the type from its first bytes when recognised (the server checks again). */
export async function describeFile(file: File): Promise<DeclaredFile> {
  const sniffed = sniffMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  return { name: file.name, size: file.size, mime: sniffed ?? file.type };
}

/**
 * Direct upload (D-035): `prepare` (server action: permission + limits, returns a signed upload token for a
 * server-chosen path) → the browser sends the bytes straight to Supabase Storage → `commit` (server action:
 * verifies the stored object and writes the rows). Business errors come back as a failed ActionResult with an
 * `errors.*` key; network failures are thrown (callers pass them to their offline guard).
 */
export async function directUpload<T>(
  file: File,
  prepare: (declared: DeclaredFile) => Promise<ActionResult<PreparedUpload>>,
  commit: (ticket: string) => Promise<ActionResult<T>>,
  opts: { tooLarge?: string } = {},
): Promise<ActionResult<T>> {
  const declared = await describeFile(file);
  const p = await prepare(declared);
  if (!p.ok) return p;
  const { bucket, path, token, mime, ticket } = p.data;
  const body = new File([file], file.name || "file", { type: mime });
  const up = await getBrowserClient().storage.from(bucket).uploadToSignedUrl(path, token, body, { contentType: mime, upsert: false });
  if (up.error) {
    const original = (up.error as { originalError?: unknown }).originalError;
    if (original instanceof TypeError) throw original; // offline / unreachable
    const status = Number((up.error as { status?: number }).status ?? (up.error as { statusCode?: string }).statusCode);
    if (status === 413) return { ok: false, error: opts.tooLarge ?? "fileTooLarge" };
    if (status === 415) return { ok: false, error: "fileType" };
    console.error("upload", up.error);
    return { ok: false, error: "uploadFailed" };
  }
  return commit(ticket);
}

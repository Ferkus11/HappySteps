import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/** Short-lived signed URL for a private storage object (caller must have checked access). */
export async function signedUrl(bucket: string, path: string | null | undefined, expiresIn = 300): Promise<string | null> {
  if (!path) return null;
  const { data } = await createServiceClient().storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

export async function signedUrls(bucket: string, paths: string[], expiresIn = 300): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await createServiceClient().storage.from(bucket).createSignedUrls(unique, expiresIn);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

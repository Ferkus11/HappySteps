/**
 * Copies every Storage file from one Supabase to another (Supabase Cloud → self-hosted), bucket by bucket.
 * Every file is uploaded with upsert, so a re-run is safe (it copies everything again). Do not skip files that
 * "already exist" on the target: after the database restore storage.objects lists them although the files are
 * not there yet. See docs/self-hosting.md.
 *
 *   SOURCE_SUPABASE_URL=https://<ref>.supabase.co SOURCE_SERVICE_ROLE_KEY=… \
 *   TARGET_SUPABASE_URL=https://api.example.kz   TARGET_SERVICE_ROLE_KEY=… \
 *   npm run storage:copy -- [--dry-run] [--bucket receipts]
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type FileEntry = { path: string; size: number | null; mimetype: string | null };

function client(urlVar: string, keyVar: string): SupabaseClient {
  const url = process.env[urlVar];
  const key = process.env[keyVar];
  if (!url || !key) throw new Error(`Задайте ${urlVar} и ${keyVar}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** All files under `prefix` (recursively). Storage `list` returns folders as entries without an id. */
async function listAll(db: SupabaseClient, bucket: string, prefix = ""): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(db, bucket, path)));
      else {
        const meta = (item.metadata ?? {}) as { size?: number; mimetype?: string };
        out.push({ path, size: meta.size ?? null, mimetype: meta.mimetype ?? null });
      }
    }
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyBucket = args.includes("--bucket") ? args[args.indexOf("--bucket") + 1] : null;
  const src = client("SOURCE_SUPABASE_URL", "SOURCE_SERVICE_ROLE_KEY");
  const dst = client("TARGET_SUPABASE_URL", "TARGET_SERVICE_ROLE_KEY");

  const { data: buckets, error } = await src.storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);
  const { data: targetBuckets } = await dst.storage.listBuckets();
  const existing = new Set((targetBuckets ?? []).map((b) => b.id));

  let copied = 0;
  let failed = 0;
  for (const b of buckets ?? []) {
    if (onlyBucket && b.id !== onlyBucket) continue;
    if (!existing.has(b.id) && !dryRun) {
      // Normally the buckets already exist (they come from the migrations / the database restore).
      const res = await dst.storage.createBucket(b.id, {
        public: b.public,
        fileSizeLimit: b.file_size_limit ?? undefined,
        allowedMimeTypes: b.allowed_mime_types ?? undefined,
      });
      if (res.error) throw new Error(`createBucket ${b.id}: ${res.error.message}`);
    }
    const files = await listAll(src, b.id);
    console.log(`${b.id}: ${files.length} файлов`);
    for (const f of files) {
      if (dryRun) {
        console.log(`  копировать ${b.id}/${f.path}`);
        copied++;
        continue;
      }
      const dl = await src.storage.from(b.id).download(f.path);
      if (dl.error || !dl.data) {
        console.error(`  ✗ ${b.id}/${f.path}: ${dl.error?.message}`);
        failed++;
        continue;
      }
      const up = await dst.storage
        .from(b.id)
        .upload(f.path, dl.data, { upsert: true, contentType: f.mimetype ?? dl.data.type ?? "application/octet-stream" });
      if (up.error) {
        console.error(`  ✗ ${b.id}/${f.path}: ${up.error.message}`);
        failed++;
        continue;
      }
      copied++;
    }
  }
  console.log(`${dryRun ? "К копированию" : "Скопировано"}: ${copied}, ошибок: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

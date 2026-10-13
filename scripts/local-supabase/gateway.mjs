// Local gateway exposing the Supabase URL layout on :54321 (dev/CI only, no Docker).
//   /auth/v1/*      → GoTrue  (127.0.0.1:9999)
//   /rest/v1/*      → PostgREST (127.0.0.1:3001)
//   /storage/v1/*   → minimal Storage API emulation (files on local disk): service-role upload/remove/info/
//                     download, signed download URLs, signed *upload* URLs (browser → storage, D-035) and the
//                     buckets' file_size_limit / allowed_mime_types like real Storage
//   /realtime/v1/*  → minimal Realtime (postgres_changes) emulation, see realtime.mjs
// Production uses real Supabase (Cloud or self-hosted); app code is identical.
import http from "node:http";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { jwtVerify, SignJWT } from "jose";
import pg from "pg";
import { attachRealtime } from "./realtime.mjs";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const SECRET = new TextEncoder().encode(process.env.LOCAL_JWT_SECRET);
const STORAGE_DIR = process.env.STORAGE_DIR ?? ".local-supabase/storage";
/** Signed upload URLs expire quickly here (Supabase Cloud: 2 hours); the app never relies on more. */
const UPLOAD_TOKEN_TTL = Number(process.env.UPLOAD_TOKEN_TTL ?? 15 * 60);
const db = process.env.LOCAL_DB_URL ? new pg.Pool({ connectionString: process.env.LOCAL_DB_URL, max: 2 }) : null;
const upstreams = {
  "/auth/v1": process.env.AUTH_UPSTREAM ?? "http://127.0.0.1:9999",
  "/rest/v1": process.env.REST_UPSTREAM ?? "http://127.0.0.1:3001",
};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "access-control-expose-headers": "content-range, x-total-count",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isBuf ? {} : { "content-type": "application/json" }), ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}

class TooLarge extends Error {}

async function readBody(req, max = Infinity) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw new TooLarge();
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function proxy(req, res, base, prefix) {
  const target = new URL(req.url.slice(prefix.length) || "/", base);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  try {
    const r = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
    const out = {};
    r.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...cors, ...out, "content-length": buf.length });
    res.end(buf);
  } catch (e) {
    send(res, 502, { message: `upstream error: ${e.message}` });
  }
}

async function role(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload.role;
  } catch {
    return null;
  }
}

function safePath(bucket, key) {
  const p = normalize(join(STORAGE_DIR, bucket, key));
  if (!p.startsWith(normalize(STORAGE_DIR))) throw new Error("bad path");
  return p;
}

/** The bucket's limits from storage.buckets (null when the bucket does not exist). */
async function bucketLimits(bucket) {
  if (!db) return { size: null, types: null };
  const { rows } = await db.query("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [bucket]);
  if (!rows.length) return null;
  return { size: rows[0].file_size_limit == null ? null : Number(rows[0].file_size_limit), types: rows[0].allowed_mime_types };
}

const mimeAllowed = (types, mime) =>
  !types?.length || types.some((t) => t === mime || (t.endsWith("/*") && mime.startsWith(t.slice(0, -1))));

const tooLarge = (res) => send(res, 413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });

/**
 * Stores one object like Storage does: refuses an existing key unless `upsert`, enforces the bucket's size and
 * MIME limits, keeps the content type and size next to the file.
 */
async function putObject(req, res, bucket, key, upsert) {
  const limits = await bucketLimits(bucket);
  if (!limits) return send(res, 400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
  const file = safePath(bucket, key);
  if (!upsert) {
    try {
      await stat(file);
      return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    } catch {}
  }
  let raw;
  try {
    // multipart overhead is small; the exact check is on the file itself below
    raw = await readBody(req, limits.size == null ? Infinity : limits.size + 64 * 1024);
  } catch (e) {
    if (e instanceof TooLarge) return tooLarge(res);
    throw e;
  }
  let data = raw;
  let contentType = req.headers["content-type"] ?? "application/octet-stream";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await new Request("http://x", { method: "POST", headers: { "content-type": contentType }, body: raw }).formData();
    let blob = null;
    for (const [, v] of form.entries()) if (typeof v !== "string") blob = v;
    if (!blob) return send(res, 400, { message: "no file" });
    data = Buffer.from(await blob.arrayBuffer());
    contentType = blob.type || "application/octet-stream";
  }
  contentType = contentType.split(";")[0].trim().toLowerCase();
  if (limits.size != null && data.length > limits.size) return tooLarge(res);
  if (!mimeAllowed(limits.types, contentType)) {
    return send(res, 415, { statusCode: "415", error: "invalid_mime_type", message: `mime type ${contentType} is not supported` });
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  await writeFile(file + ".meta.json", JSON.stringify({ contentType, size: data.length, createdAt: new Date().toISOString() }));
  return send(res, 200, { Id: crypto.randomUUID(), Key: `${bucket}/${key}` });
}

async function storage(req, res, path) {
  const url = new URL(path, "http://x");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); // ["object", ...]
  if (parts[0] !== "object") return send(res, 404, { message: "not found" });

  // Public download by signed token
  if (parts[1] === "sign" && req.method === "GET") {
    const token = url.searchParams.get("token");
    try {
      const { payload } = await jwtVerify(token ?? "", SECRET);
      const want = parts.slice(2).join("/");
      if (payload.url !== want || payload.upload) return send(res, 400, { message: "invalid signature" });
      const [bucket, ...rest] = want.split("/");
      const file = safePath(bucket, rest.join("/"));
      const meta = JSON.parse(await readFile(file + ".meta.json", "utf8").catch(() => "{}"));
      const data = await readFile(file);
      const download = url.searchParams.get("download");
      return send(res, 200, data, {
        "content-type": meta.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=60",
        ...(download !== null ? { "content-disposition": `attachment; filename="${encodeURIComponent(download || rest.at(-1))}"` } : {}),
      });
    } catch {
      return send(res, 400, { message: "invalid or expired token" });
    }
  }

  // Upload by signed upload token (browser → storage). The token names exactly one object and expires soon;
  // it cannot overwrite (unless it was created with upsert) and the bucket limits apply.
  if (parts[1] === "upload" && parts[2] === "sign" && req.method === "PUT") {
    const want = parts.slice(3).join("/");
    let payload;
    try {
      ({ payload } = await jwtVerify(url.searchParams.get("token") ?? "", SECRET));
    } catch {
      return send(res, 400, { statusCode: "403", error: "InvalidJWT", message: "invalid or expired token" });
    }
    if (payload.upload !== true || payload.url !== want) return send(res, 400, { statusCode: "403", error: "InvalidSignature", message: "The signature does not match" });
    const [bucket, ...rest] = want.split("/");
    if (!bucket || !rest.length) return send(res, 400, { message: "bad path" });
    return putObject(req, res, bucket, rest.join("/"), payload.upsert === true);
  }

  // Everything else requires the service role (the app only touches storage from the server).
  if ((await role(req)) !== "service_role") return send(res, 403, { message: "forbidden" });

  // Create a signed upload URL (response shape as Supabase Storage: { url: "/object/upload/sign/<bucket>/<path>?token=…" }).
  if (parts[1] === "upload" && parts[2] === "sign" && req.method === "POST") {
    const full = parts.slice(3).join("/");
    const [bucket, ...rest] = full.split("/");
    if (!bucket || !rest.length) return send(res, 400, { message: "bad path" });
    if (!(await bucketLimits(bucket))) return send(res, 400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    safePath(bucket, rest.join("/"));
    const upsert = req.headers["x-upsert"] === "true";
    if (!upsert) {
      try {
        await stat(safePath(bucket, rest.join("/")));
        return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      } catch {}
    }
    const token = await new SignJWT({ url: full, upload: true, upsert })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL)
      .sign(SECRET);
    return send(res, 200, { url: `/object/upload/sign/${full}?token=${token}` });
  }

  // Object metadata (storage-js `info()`): real size and content type as stored.
  if (parts[1] === "info" && req.method === "GET") {
    const [bucket, ...rest] = parts.slice(2);
    const key = rest.join("/");
    try {
      const file = safePath(bucket, key);
      const st = await stat(file);
      const meta = JSON.parse(await readFile(file + ".meta.json", "utf8").catch(() => "{}"));
      const contentType = meta.contentType ?? "application/octet-stream";
      return send(res, 200, {
        id: null,
        version: null,
        name: key,
        bucket_id: bucket,
        size: st.size,
        content_type: contentType,
        cache_control: "max-age=3600",
        etag: null,
        last_modified: st.mtime.toISOString(),
        created_at: meta.createdAt ?? st.mtime.toISOString(),
        metadata: { size: st.size, mimetype: contentType },
      });
    } catch {
      return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
  }

  if (parts[1] === "sign" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const expiresIn = Number(body.expiresIn ?? 60);
    const signOne = async (full) =>
      `/object/sign/${full}?token=${await new SignJWT({ url: full })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
        .sign(SECRET)}`;
    if (Array.isArray(body.paths)) {
      const bucket = parts[2];
      const out = [];
      for (const p of body.paths) out.push({ path: p, error: null, signedURL: await signOne(`${bucket}/${p}`) });
      return send(res, 200, out);
    }
    const full = parts.slice(2).join("/");
    const [bucket, ...rest] = full.split("/");
    try {
      await stat(safePath(bucket, rest.join("/")));
    } catch {
      return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
    return send(res, 200, { signedURL: await signOne(full) });
  }

  if ((req.method === "POST" || req.method === "PUT") && parts.length >= 3) {
    const [, bucket, ...rest] = parts;
    return putObject(req, res, bucket, rest.join("/"), req.headers["x-upsert"] === "true" || req.method === "PUT");
  }

  if (req.method === "DELETE" && parts.length === 2) {
    const bucket = parts[1];
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const out = [];
    for (const p of body.prefixes ?? []) {
      const file = safePath(bucket, p);
      await rm(file, { force: true });
      await rm(file + ".meta.json", { force: true });
      out.push({ name: p, bucket_id: bucket });
    }
    return send(res, 200, out);
  }

  if (req.method === "GET" && parts[1] === "authenticated") {
    const [, , bucket, ...rest] = parts;
    try {
      const file = safePath(bucket, rest.join("/"));
      const meta = JSON.parse(await readFile(file + ".meta.json", "utf8").catch(() => "{}"));
      const data = await readFile(file);
      const type = { "content-type": meta.contentType ?? "application/octet-stream", "accept-ranges": "bytes" };
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (range && data.length) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
        if (start > end) return send(res, 416, Buffer.alloc(0), { "content-range": `bytes */${data.length}` });
        return send(res, 206, data.subarray(start, end + 1), { ...type, "content-range": `bytes ${start}-${end}/${data.length}` });
      }
      return send(res, 200, data, type);
    } catch {
      return send(res, 404, { message: "Object not found" });
    }
  }
  return send(res, 404, { message: "not implemented in local gateway" });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, Buffer.alloc(0));
    for (const [prefix, base] of Object.entries(upstreams)) {
      if (req.url === prefix || req.url.startsWith(prefix + "/") || req.url.startsWith(prefix + "?")) {
        return await proxy(req, res, base, prefix);
      }
    }
    if (req.url.startsWith("/storage/v1/")) return await storage(req, res, req.url.slice("/storage/v1".length));
    send(res, 404, { message: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
});

attachRealtime(server, { secret: SECRET, dbUrl: process.env.LOCAL_DB_URL });
server.listen(PORT, "127.0.0.1", () => console.log(`gateway on :${PORT}`));

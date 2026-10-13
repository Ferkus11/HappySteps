/**
 * Direct uploads (D-035) against the running stack's Storage (local gateway emulation or real Supabase):
 * signed upload URLs are bound to one path, cannot overwrite, obey the bucket limits, and the commit
 * verification rejects a wrong path, a foreign kindergarten and an oversized or mislabelled object.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ActionError } from "@/lib/actions/result";
import { TICKET_TTL_MS, createStorageIo, signTicket, verifyUpload, type UploadExpectation, type UploadKind } from "@/lib/uploads-core";
import { admin } from "./db";
import { fx } from "./fixtures";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = "rls-test-ticket-secret";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let service: SupabaseClient;
let anon: SupabaseClient;
let A = "";
let B = "";
let child = "";
let user = "";
const created: { bucket: string; path: string }[] = [];

const pdf = (size: number) => {
  const head = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const tail = Buffer.from("\n%%EOF\n", "latin1");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length - tail.length), 0x20), tail]);
};
const jpeg = (size: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 0)]);
const blob = (buf: Buffer, type: string) => new Blob([new Uint8Array(buf)], { type });

async function signedUpload(bucket: string, path: string) {
  const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(path);
  expect(error).toBeNull();
  created.push({ bucket, path });
  return data!;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof ActionError) return e.code;
    throw e;
  }
}

const ticket = (kind: UploadKind, path: string, over: Record<string, unknown> = {}) =>
  signTicket(SECRET, { k: kind, p: path, u: user, g: A, t: child, n: "file", x: Date.now() + TICKET_TTL_MS, ...over });

beforeAll(async () => {
  service = createClient(URL_, SERVICE, opts);
  anon = createClient(URL_, ANON, opts);
  const f = await fx();
  A = f.A;
  B = f.B;
  child = f.children["Алихан"];
  user = f.users.parent;
});

afterAll(async () => {
  const byBucket = new Map<string, string[]>();
  for (const c of created) byBucket.set(c.bucket, [...(byBucket.get(c.bucket) ?? []), c.path]);
  for (const [bucket, paths] of byBucket) await service.storage.from(bucket).remove(paths);
});

describe("storage · signed upload URLs", () => {
  it("anon/authenticated clients cannot create signed upload URLs (service role only)", async () => {
    const { error } = await anon.storage.from("child-documents").createSignedUploadUrl(`${A}/${child}/${randomUUID()}.pdf`);
    expect(error).not.toBeNull();
  });

  it("a browser (anon key) uploads > 4.5 MB straight to storage; info reports real size and type", async () => {
    const path = `${A}/${child}/${randomUUID()}.pdf`;
    const { token } = await signedUpload("child-documents", path);
    const body = pdf(6 * 1024 * 1024);
    const up = await anon.storage.from("child-documents").uploadToSignedUrl(path, token, blob(body, "application/pdf"), { contentType: "application/pdf" });
    expect(up.error).toBeNull();
    const { data: info } = await service.storage.from("child-documents").info(path);
    expect(info?.size).toBe(body.length);
    expect(info?.contentType).toBe("application/pdf");
    // and it can be opened via a short-lived signed URL
    const { data: signed } = await service.storage.from("child-documents").createSignedUrl(path, 60);
    const res = await fetch(signed!.signedUrl);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(body.length);
  });

  it("the token is bound to one path and cannot overwrite", async () => {
    const path = `${A}/${child}/${randomUUID()}.pdf`;
    const { token } = await signedUpload("child-documents", path);
    const other = `${A}/${child}/${randomUUID()}.pdf`;
    created.push({ bucket: "child-documents", path: other });
    const wrong = await anon.storage.from("child-documents").uploadToSignedUrl(other, token, blob(pdf(100), "application/pdf"));
    expect(wrong.error).not.toBeNull();
    const wrongBucket = await anon.storage.from("receipts").uploadToSignedUrl(path, token, blob(pdf(100), "application/pdf"));
    expect(wrongBucket.error).not.toBeNull();
    expect((await anon.storage.from("child-documents").uploadToSignedUrl(path, token, blob(pdf(100), "application/pdf"))).error).toBeNull();
    const again = await anon.storage.from("child-documents").uploadToSignedUrl(path, token, blob(pdf(200), "application/pdf"));
    expect(again.error).not.toBeNull();
    expect((await service.storage.from("child-documents").info(path)).data?.size).toBe(100);
    // a garbage token is refused
    expect((await anon.storage.from("child-documents").uploadToSignedUrl(path, "x.y.z", blob(pdf(100), "application/pdf"))).error).not.toBeNull();
  });

  it("bucket limits apply to signed uploads: size and MIME type", async () => {
    const big = `${A}/${child}/photo-${randomUUID()}.jpg`;
    const t1 = await signedUpload("child-photos", big);
    const r1 = await anon.storage.from("child-photos").uploadToSignedUrl(big, t1.token, blob(jpeg(5 * 1024 * 1024 + 10), "image/jpeg"));
    expect((r1.error as { status?: number } | null)?.status).toBe(413);
    const html = `${A}/${child}/${randomUUID()}.pdf`;
    const t2 = await signedUpload("receipts", html);
    const r2 = await anon.storage.from("receipts").uploadToSignedUrl(html, t2.token, blob(Buffer.from("<html></html>"), "text/html"));
    expect((r2.error as { status?: number } | null)?.status).toBe(415);
    expect((await service.storage.from("receipts").info(html)).error).not.toBeNull();
  });
});

describe("uploads · commit verification against storage", () => {
  const io = () => createStorageIo(service, URL_, SERVICE);
  const want = (over: Partial<UploadExpectation> = {}): UploadExpectation => ({ kind: "childDocument", userId: user, kgId: A, target: child, prefix: `${A}/${child}/`, ...over });

  async function stored(bucket: string, path: string, body: Buffer, type: string) {
    const { token } = await signedUpload(bucket, path);
    const up = await anon.storage.from(bucket).uploadToSignedUrl(path, token, blob(body, type), { contentType: type });
    expect(up.error).toBeNull();
  }

  it("accepts the expected object", async () => {
    const path = `${A}/${child}/${randomUUID()}.pdf`;
    await stored("child-documents", path, pdf(5000), "application/pdf");
    const v = await verifyUpload(io(), SECRET, ticket("childDocument", path), want());
    expect(v).toMatchObject({ path, size: 5000, mime: "application/pdf", ext: "pdf" });
  });

  it("rejects a wrong path (another child's folder, edited ticket) and leaves the object alone", async () => {
    const path = `${A}/${child}/${randomUUID()}.pdf`;
    await stored("child-documents", path, pdf(5000), "application/pdf");
    const otherChild = (await fx()).children["Миша"];
    expect(await code(verifyUpload(io(), SECRET, ticket("childDocument", path), want({ target: otherChild, prefix: `${A}/${otherChild}/` })))).toBe("forbidden");
    const t = ticket("childDocument", path);
    const forgedBody = Buffer.from(JSON.stringify({ k: "childDocument", p: `${A}/${otherChild}/x.pdf`, u: user, g: A, t: child, n: "", x: Date.now() + 1e6 })).toString("base64url");
    expect(await code(verifyUpload(io(), SECRET, `${forgedBody}.${t.split(".")[1]}`, want()))).toBe("uploadFailed");
    expect((await service.storage.from("child-documents").info(path)).error).toBeNull();
  });

  it("rejects an upload prepared in a foreign kindergarten", async () => {
    const path = `${B}/${child}/${randomUUID()}.pdf`;
    await stored("child-documents", path, pdf(5000), "application/pdf");
    // ticket from garden B presented in garden A, and a garden-B path under a garden-A ticket
    expect(await code(verifyUpload(io(), SECRET, ticket("childDocument", path, { g: B }), want()))).toBe("forbidden");
    expect(await code(verifyUpload(io(), SECRET, ticket("childDocument", path), want()))).toBe("forbidden");
    expect((await service.storage.from("child-documents").info(path)).error).toBeNull();
  });

  it("removes and rejects an oversized object (bucket limit lifted to reach the app check)", async () => {
    const path = `${A}/${child}/photo-${randomUUID()}.jpg`;
    const before = await admin((c) => c.query("select file_size_limit from storage.buckets where id = 'child-photos'"));
    await admin((c) => c.query("update storage.buckets set file_size_limit = null where id = 'child-photos'"));
    try {
      await stored("child-photos", path, jpeg(5 * 1024 * 1024 + 1), "image/jpeg");
    } finally {
      await admin((c) => c.query("update storage.buckets set file_size_limit = $1 where id = 'child-photos'", [before.rows[0].file_size_limit]));
    }
    expect(await code(verifyUpload(io(), SECRET, ticket("childPhoto", path), want({ kind: "childPhoto" })))).toBe("fileTooLarge");
    expect((await service.storage.from("child-photos").info(path)).error).not.toBeNull();
  });

  it("removes and rejects an object whose bytes are not what its type says", async () => {
    const path = `${A}/${child}/${randomUUID()}.png`;
    await stored("receipts", path, Buffer.from("<html>not an image</html>"), "image/png");
    expect(await code(verifyUpload(io(), SECRET, ticket("receipt", path), want({ kind: "receipt" })))).toBe("fileType");
    expect((await service.storage.from("receipts").info(path)).error).not.toBeNull();
  });

  it("missing object → uploadFailed", async () => {
    expect(await code(verifyUpload(io(), SECRET, ticket("childDocument", `${A}/${child}/${randomUUID()}.pdf`), want()))).toBe("uploadFailed");
  });
});

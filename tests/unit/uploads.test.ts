import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/actions/result";
import {
  TICKET_TTL_MS,
  UPLOAD_SPECS,
  checkDeclared,
  readTicket,
  signTicket,
  verifyUpload,
  type StorageIo,
  type UploadTicket,
} from "@/lib/uploads-core";

const SECRET = "test-secret";
const KG = "11111111-1111-4111-8111-111111111111";
const OTHER_KG = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CHILD = "44444444-4444-4444-8444-444444444444";
const PDF = new TextEncoder().encode("%PDF-1.4\n%â\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

const ticket = (over: Partial<UploadTicket> = {}): UploadTicket => ({
  k: "childDocument",
  p: `${KG}/${CHILD}/aaaa.pdf`,
  u: USER,
  g: KG,
  t: CHILD,
  n: "справка.pdf",
  x: Date.now() + TICKET_TTL_MS,
  ...over,
});

const want = { kind: "childDocument" as const, userId: USER, kgId: KG, target: CHILD, prefix: `${KG}/${CHILD}/` };

/** In-memory storage: one object per path, records removals. */
function fakeIo(objects: Record<string, { size: number; mime: string; bytes: Uint8Array }>) {
  const removed: string[] = [];
  const io: StorageIo = {
    info: async (_b, p) => (objects[p] ? { size: objects[p].size, mime: objects[p].mime } : null),
    head: async (_b, p, n) => objects[p]?.bytes.slice(0, n) ?? null,
    remove: async (_b, p) => {
      removed.push(p);
      delete objects[p];
    },
  };
  return { io, removed };
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

describe("uploads · declared file (prepare step)", () => {
  it("accepts allowed types within the limit and returns the extension", () => {
    expect(checkDeclared("childDocument", { name: "a.pdf", size: 6 * 1024 * 1024, mime: "application/pdf" })).toBe("pdf");
    expect(checkDeclared("logo", { name: "l.png", size: 1000, mime: "image/png" })).toBe("png");
  });
  it("rejects oversized, empty and unexpected types with the module's error keys", () => {
    expect(() => checkDeclared("receipt", { name: "r.pdf", size: 15 * 1024 * 1024 + 1, mime: "application/pdf" })).toThrow("fileTooLarge");
    expect(() => checkDeclared("clubPhoto", { name: "c.jpg", size: 5 * 1024 * 1024 + 1, mime: "image/jpeg" })).toThrow("photoTooLarge");
    expect(() => checkDeclared("logo", { name: "l.png", size: 2 * 1024 * 1024 + 1, mime: "image/png" })).toThrow("fileTooLarge");
    expect(() => checkDeclared("chat", { name: "x", size: 0, mime: "image/png" })).toThrow("invalid");
    expect(() => checkDeclared("childPhoto", { name: "x.pdf", size: 10, mime: "application/pdf" })).toThrow("fileType");
    expect(() => checkDeclared("announcement", { name: "x.html", size: 10, mime: "text/html" })).toThrow("fileType");
  });
  it("limits match the buckets' defence-in-depth limits (migration 20261014130000, clubs)", () => {
    expect(UPLOAD_SPECS.logo.max).toBe(2 * 1024 * 1024);
    expect(UPLOAD_SPECS.childPhoto.max).toBe(5 * 1024 * 1024);
    expect(UPLOAD_SPECS.clubPhoto.max).toBe(5 * 1024 * 1024);
    for (const k of ["chat", "announcement", "childDocument", "staffDocument", "receipt"] as const) expect(UPLOAD_SPECS[k].max).toBe(15 * 1024 * 1024);
  });
});

describe("uploads · ticket", () => {
  it("round-trips and expires", () => {
    const t = ticket();
    expect(readTicket(SECRET, signTicket(SECRET, t))).toEqual(t);
    expect(readTicket(SECRET, signTicket(SECRET, ticket({ x: Date.now() - 1 })))).toBeNull();
  });
  it("is useless with another secret or any edit (the client cannot choose the path)", () => {
    const token = signTicket(SECRET, ticket());
    expect(readTicket("other", token)).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(ticket({ p: `${KG}/${CHILD}/other.pdf` }))).toString("base64url");
    expect(readTicket(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(readTicket(SECRET, `${token}.x`)).toBeNull();
    expect(readTicket(SECRET, 42)).toBeNull();
  });
});

describe("uploads · commit verification", () => {
  it("accepts the stored object and reports its real facts", async () => {
    const { io } = fakeIo({ [`${KG}/${CHILD}/aaaa.pdf`]: { size: 6 * 1024 * 1024, mime: "application/pdf", bytes: PDF } });
    const v = await verifyUpload(io, SECRET, signTicket(SECRET, ticket()), want);
    expect(v).toMatchObject({ bucket: "child-documents", path: `${KG}/${CHILD}/aaaa.pdf`, size: 6 * 1024 * 1024, mime: "application/pdf", ext: "pdf", name: "справка.pdf" });
  });

  it("rejects a forged/expired ticket without touching storage", async () => {
    const { io, removed } = fakeIo({ [`${KG}/${CHILD}/aaaa.pdf`]: { size: 10, mime: "application/pdf", bytes: PDF } });
    expect(await code(verifyUpload(io, SECRET, "nope", want))).toBe("uploadFailed");
    expect(await code(verifyUpload(io, SECRET, signTicket("other", ticket()), want))).toBe("uploadFailed");
    expect(await code(verifyUpload(io, SECRET, signTicket(SECRET, ticket({ x: 1 })), want))).toBe("uploadFailed");
    expect(removed).toEqual([]);
  });

  it("rejects a wrong path, another user, a foreign kindergarten, another target or kind", async () => {
    const { io, removed } = fakeIo({});
    const sign = (o: Partial<UploadTicket>) => signTicket(SECRET, ticket(o));
    // path outside the expected folder (another child's folder / another kindergarten's prefix)
    expect(await code(verifyUpload(io, SECRET, sign({ p: `${KG}/${OTHER_KG}/aaaa.pdf` }), want))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({ p: `${OTHER_KG}/${CHILD}/aaaa.pdf` }), want))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({ p: `${KG}/${CHILD}/../x/aaaa.pdf` }), want))).toBe("forbidden");
    // prepared in another kindergarten, by another user, for another child, for another kind
    expect(await code(verifyUpload(io, SECRET, sign({ g: OTHER_KG }), want))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({}), { ...want, kgId: OTHER_KG, prefix: `${OTHER_KG}/${CHILD}/` }))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({ u: OTHER_KG }), want))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({ t: OTHER_KG }), want))).toBe("forbidden");
    expect(await code(verifyUpload(io, SECRET, sign({ k: "receipt" }), want))).toBe("forbidden");
    // an expected prefix outside the kindergarten is refused as well
    expect(await code(verifyUpload(io, SECRET, sign({}), { ...want, prefix: `${CHILD}/` }))).toBe("forbidden");
    expect(removed).toEqual([]);
  });

  it("missing object → uploadFailed", async () => {
    const { io } = fakeIo({});
    expect(await code(verifyUpload(io, SECRET, signTicket(SECRET, ticket()), want))).toBe("uploadFailed");
  });

  it("oversized object is removed and rejected", async () => {
    const path = `${KG}/${CHILD}/aaaa.pdf`;
    const { io, removed } = fakeIo({ [path]: { size: 15 * 1024 * 1024 + 1, mime: "application/pdf", bytes: PDF } });
    expect(await code(verifyUpload(io, SECRET, signTicket(SECRET, ticket()), want))).toBe("fileTooLarge");
    expect(removed).toEqual([path]);
  });

  it("wrong real type (bytes vs. storage type vs. extension) is removed and rejected", async () => {
    const path = `${KG}/${CHILD}/aaaa.pdf`;
    for (const obj of [
      { size: 20, mime: "application/pdf", bytes: new TextEncoder().encode("<html>not a pdf</html>") },
      { size: 20, mime: "image/png", bytes: PNG }, // a PNG under a .pdf path
      { size: 20, mime: "application/pdf", bytes: PNG }, // PNG bytes claiming to be a PDF
      { size: 0, mime: "application/pdf", bytes: PDF },
    ]) {
      const { io, removed } = fakeIo({ [path]: obj });
      expect(await code(verifyUpload(io, SECRET, signTicket(SECRET, ticket()), want))).toBe(obj.size ? "fileType" : "invalid");
      expect(removed).toEqual([path]);
    }
  });
});

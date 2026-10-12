import { describe, expect, it, vi } from "vitest";
import { daysBetween, expiryState, isHeic, reminderThreshold, sniffMime, titleFromFileName } from "@/lib/documents-logic";
import { prepareDocumentFile } from "@/lib/heic";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("documents · file type sniffing", () => {
  it("recognises JPEG, PNG, PDF and WEBP by their first bytes", () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("image/png");
    expect(sniffMime(ascii("%PDF-1.4"))).toBe("application/pdf");
    expect(sniffMime(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("rejects anything else (HTML disguised as an image, HEIC, empty)", () => {
    expect(sniffMime(ascii("<html><script>"))).toBeNull();
    expect(sniffMime(ascii("\0\0\0\x18ftypheic"))).toBeNull();
    expect(sniffMime(bytes())).toBeNull();
    expect(sniffMime(ascii("RIFF\0\0\0\0WAVE"))).toBeNull();
  });
});

describe("documents · expiry", () => {
  const today = "2026-10-12";
  it("counts whole days across months", () => {
    expect(daysBetween(today, "2026-11-01")).toBe(20);
    expect(daysBetween(today, "2026-10-11")).toBe(-1);
  });
  it("badge states", () => {
    expect(expiryState(null, today)).toEqual({ kind: "none" });
    expect(expiryState("2026-10-12", today)).toEqual({ kind: "soon", days: 0 });
    expect(expiryState("2026-11-11", today)).toEqual({ kind: "soon", days: 30 });
    expect(expiryState("2026-11-12", today)).toEqual({ kind: "ok", days: 31 });
    expect(expiryState("2026-10-02", today)).toEqual({ kind: "expired", days: 10 });
  });
  it("reminder thresholds mirror SQL document_expiry_due", () => {
    expect(reminderThreshold(31)).toBeNull();
    expect(reminderThreshold(30)).toBe(30);
    expect(reminderThreshold(8)).toBe(30);
    expect(reminderThreshold(7)).toBe(7);
    expect(reminderThreshold(0)).toBe(7);
    expect(reminderThreshold(-1)).toBeNull();
  });
});

describe("documents · HEIC → JPEG in the browser", () => {
  it("detects HEIC by type or extension (Chrome/Android often give no type)", () => {
    expect(isHeic({ type: "image/heic", name: "x" })).toBe(true);
    expect(isHeic({ type: "image/heif", name: "x" })).toBe(true);
    expect(isHeic({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeic({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
    expect(isHeic({ type: "application/pdf", name: "a.pdf" })).toBe(false);
  });

  it("converts HEIC with the converter and renames to .jpg", async () => {
    const convert = vi.fn(async () => new Blob([bytes(0xff, 0xd8, 0xff, 0xdb)], { type: "image/jpeg" }));
    const heic = new File([ascii("\0\0\0\x18ftypheic")], "IMG_0042.HEIC", { type: "image/heic" });
    const out = await prepareDocumentFile(heic, convert);
    expect(convert).toHaveBeenCalledOnce();
    expect(out.name).toBe("IMG_0042.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array(await out.arrayBuffer()))).toBe("image/jpeg");
  });

  it("leaves other files untouched", async () => {
    const convert = vi.fn();
    const pdf = new File([ascii("%PDF-1.4")], "spravka.pdf", { type: "application/pdf" });
    expect(await prepareDocumentFile(pdf, convert)).toBe(pdf);
    expect(convert).not.toHaveBeenCalled();
  });

  it("title fallback from the file name", () => {
    expect(titleFromFileName("Справка 095.pdf")).toBe("Справка 095");
    expect(titleFromFileName("IMG_1.jpg")).toBe("IMG_1");
  });
});

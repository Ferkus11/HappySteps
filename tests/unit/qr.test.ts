import { describe, expect, it } from "vitest";
import { encodeQr, qrCapacity, qrSvg, rsRemainder } from "@/lib/qr";
import golden from "./fixtures/qr-golden.json";

const bits = (m: boolean[][]) => m.map((r) => r.map((c) => (c ? "1" : "0")).join(""));

describe("QR encoder (byte mode, level M)", () => {
  it("matches reference matrices (generated with the python `qrcode` package)", () => {
    for (const g of golden) {
      const q = encodeQr(g.text, { version: g.version, mask: g.mask });
      expect(q.size).toBe(g.version * 4 + 17);
      expect(bits(q.modules)).toEqual(g.rows);
    }
  });

  it("Reed–Solomon remainder of the ISO example (1-M «01234567»)", () => {
    // ISO/IEC 18004 Annex I: data codewords of "01234567" (numeric, 1-M) and their 10 EC codewords.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it("picks the smallest version that fits", () => {
    expect(encodeQr("hi").version).toBe(1);
    expect(encodeQr("x".repeat(qrCapacity(1))).version).toBe(1);
    expect(encodeQr("x".repeat(qrCapacity(1) + 1)).version).toBe(2);
    expect(encodeQr("https://happysteps.kz/apply/sadik-solnyshko-almaty").version).toBe(4);
    expect(encodeQr("x".repeat(qrCapacity(10))).version).toBe(10);
    expect(() => encodeQr("x".repeat(qrCapacity(10) + 1))).toThrow();
  });

  it("has the finder patterns, timing pattern and dark module in place", () => {
    const { modules: m, size } = encodeQr("https://happysteps.kz/apply/e2e-a");
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(m[r][c] && m[r + 6][c + 6] && m[r + 3][c + 3]).toBe(true);
      expect(m[r + 1][c + 1]).toBe(false);
    }
    for (let i = 8; i < size - 8; i++) expect(m[6][i]).toBe(i % 2 === 0);
    expect(m[size - 8][8]).toBe(true);
  });

  it("counts UTF-8 bytes (Kazakh letters take two)", () => {
    expect(qrCapacity(1)).toBe(14);
    expect(encodeQr("ә".repeat(7)).version).toBe(1);
    expect(encodeQr("ә".repeat(8)).version).toBe(2);
  });

  it("renders an SVG with a quiet zone", () => {
    const svg = qrSvg("hi", { margin: 4, title: "<link>" });
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 29 29"/);
    expect(svg).toContain("<title>&lt;link&gt;</title>");
    expect(svg).toContain('d="M4 4h1v1h-1z');
  });
});

/**
 * Minimal dependency-free QR Code encoder (ISO/IEC 18004): byte mode, error correction level M,
 * versions 1–10 (up to 213 bytes of UTF-8 — plenty for a kindergarten's application link).
 * Used for the public waitlist form link (SVG on screen, PNG download).
 */

/** ECC level M: error-correction codewords per block and the block groups [count, data codewords]. */
const ECC_M: Record<number, { ec: number; groups: [number, number][] }> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const QR_MAX_VERSION = 10;

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** modules[row][col], true = dark */
  modules: boolean[][];
}

const dataCodewords = (v: number) => ECC_M[v].groups.reduce((s, [n, d]) => s + n * d, 0);
const charCountBits = (v: number) => (v <= 9 ? 8 : 16);

/** Largest payload (bytes) a version can hold in byte mode at level M. */
export function qrCapacity(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - charCountBits(version)) / 8);
}

// ───────────── GF(256) and Reed–Solomon ─────────────
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor);
    });
  }
  return result;
}

// ───────────── Data codewords ─────────────
function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function buildCodewords(bytes: number[], version: number): number[] {
  const capacityBits = dataCodewords(version) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capacityBits / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits data into blocks, adds Reed–Solomon codewords and interleaves them. */
function interleave(data: number[], version: number): number[] {
  const { ec, groups } = ECC_M[version];
  const blocks: number[][] = [];
  let k = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(data.slice(k, k + len));
      k += len;
    }
  }
  const ecc = blocks.map((b) => rsRemainder(b, ec));
  const out: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const e of ecc) out.push(e[i]);
  return out;
}

// ───────────── Matrix ─────────────
class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  /** x = column, y = row */
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(s - 4, 3);
    this.drawFinder(3, s - 4);
    const pos = ALIGNMENT[this.version];
    const last = pos.length - 1;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0, 0); // reserve; real bits are drawn after masking
    this.drawVersion();
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
  }

  private drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /** Level M has format bits 00. */
  drawFormatBits(eccBits: number, mask: number) {
    const data = (eccBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, s - 15 + i, bit(i));
    this.setFn(8, s - 8, true); // dark module
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }

  drawCodewords(data: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** Standard penalty score (lower is better) used to pick the mask. */
  penalty(): number {
    const s = this.size;
    const m = this.modules;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let runColor = get(0);
      let run = 1;
      const seq: boolean[] = [];
      for (let i = 0; i < s; i++) seq.push(get(i));
      for (let i = 1; i < s; i++) {
        if (seq[i] === runColor) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          runColor = seq[i];
          run = 1;
        }
      }
      // finder-like 1:1:3:1:1 with 4 light modules on either side
      const pat = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= s; i++) {
        if (!pat.every((p, k) => seq[i + k] === p)) continue;
        const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !seq[i - k]);
        const lightAfter = i + 11 <= s && [7, 8, 9, 10].every((k) => !seq[i + k]);
        if (lightBefore || lightAfter) score += 40;
      }
    };
    for (let y = 0; y < s; y++) line((i) => m[y][i]);
    for (let x = 0; x < s; x++) line((i) => m[i][x]);
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = s * s;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }
}

/** Encodes text (UTF-8, byte mode, level M). Picks the smallest version and the best mask unless given. */
export function encodeQr(text: string, opts: { version?: number; mask?: number } = {}): QrCode {
  const bytes = utf8(text);
  let version = opts.version ?? 0;
  if (!version) {
    for (let v = 1; v <= QR_MAX_VERSION; v++) {
      if (bytes.length <= qrCapacity(v)) {
        version = v;
        break;
      }
    }
  }
  if (!version || version > QR_MAX_VERSION || bytes.length > qrCapacity(version)) {
    throw new Error("QR payload too long");
  }
  const codewords = interleave(buildCodewords(bytes, version), version);

  const build = (mask: number) => {
    const mx = new Matrix(version);
    mx.drawFunctionPatterns();
    mx.drawCodewords(codewords);
    mx.applyMask(mask);
    mx.drawFormatBits(0, mask);
    return mx;
  };

  let best: Matrix | null = null;
  let bestMask = 0;
  if (opts.mask !== undefined) {
    best = build(opts.mask);
    bestMask = opts.mask;
  } else {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mx = build(mask);
      const p = mx.penalty();
      if (p < bestScore) {
        bestScore = p;
        best = mx;
        bestMask = mask;
      }
    }
  }
  return { version, size: best!.size, mask: bestMask, modules: best!.modules };
}

/** SVG markup (one path, crisp edges) with a quiet zone of `margin` modules. */
export function qrSvg(text: string, opts: { margin?: number; dark?: string; light?: string; title?: string } = {}): string {
  const { modules, size } = encodeQr(text);
  const margin = opts.margin ?? 4;
  const full = size + margin * 2;
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    });
  });
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img">` +
    title +
    `<rect width="${full}" height="${full}" fill="${opts.light ?? "#ffffff"}"/>` +
    `<path d="${d}" fill="${opts.dark ?? "#000000"}"/></svg>`
  );
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

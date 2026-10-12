import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";

/**
 * Shared PDF helper (pdfkit). DejaVu Sans covers Cyrillic and all Kazakh letters (ә ғ қ ң ө ұ ү һ і).
 * Fonts live in src/assets/fonts and are copied into the standalone build via
 * `outputFileTracingIncludes` (next.config.ts) — the standalone server runs with cwd = its own folder.
 * Passing `font` to the constructor avoids pdfkit loading its built-in Helvetica AFM files.
 */
export const PDF_FONT = "regular";
export const PDF_FONT_BOLD = "bold";

export function fontFile(bold = false): string {
  return path.join(process.cwd(), "src", "assets", "fonts", bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf");
}

export function createPdf(opts: { layout?: "portrait" | "landscape"; margin?: number; title?: string } = {}): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    layout: opts.layout ?? "portrait",
    margin: opts.margin ?? 36,
    font: fontFile(),
    bufferPages: true,
    info: { Title: opts.title ?? "Happy Steps", Producer: "Happy Steps", Creator: "Happy Steps" },
  });
  doc.registerFont(PDF_FONT, fontFile());
  doc.registerFont(PDF_FONT_BOLD, fontFile(true));
  doc.font(PDF_FONT);
  return doc;
}

/** Finishes the document and returns its bytes. */
export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Content-Disposition with an ASCII fallback and a UTF-8 name (RFC 5987). */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Truncates text with "…" so it fits `width` at the document's current font and size. */
export function fitText(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let s = text;
  while (s.length > 1 && doc.widthOfString(`${s}…`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

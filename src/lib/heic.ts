import { isHeic } from "@/lib/documents-logic";

export type HeicConverter = (blob: Blob) => Promise<Blob>;

/** heic2any is large (libheif in WASM/asm.js) — load it only when an HEIC file is actually picked. */
const defaultConverter: HeicConverter = async (blob) => {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
  return Array.isArray(out) ? out[0] : out;
};

/**
 * Prepares a picked file for upload: HEIC/HEIF photos (iPhone) are converted to JPEG in the browser,
 * because the server accepts only JPEG/PNG/WEBP/PDF. Other files are returned unchanged.
 */
export async function prepareDocumentFile(file: File, convert: HeicConverter = defaultConverter): Promise<File> {
  if (!isHeic(file)) return file;
  const jpeg = await convert(file);
  const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
}

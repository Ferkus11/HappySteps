#!/usr/bin/env node
/**
 * Renders the app icons (public/icons/*.png, src/app/favicon.ico) from the in-app logo:
 * a rounded brand-crimson square with a white extra-bold «H» (Manrope), like the logo on /login.
 * One-off: `node scripts/pwa/generate-icons.mjs` (uses the pre-installed Playwright Chromium).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const BRAND = "#c02a62"; // --brand in src/app/globals.css
const BRAND_LIGHT = "#d6336c";
const font = readFileSync(path.join(ROOT, "node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2")).toString("base64");

/** full: square fills the canvas (maskable / Apple — the OS rounds it); scale: «H» height relative to the canvas. */
function html(size, { full, scale }) {
  const radius = full ? 0 : Math.round(size * 0.225);
  return `<!doctype html><html><head><style>
@font-face { font-family: M; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 800; }
html, body { margin: 0; background: transparent; }
.i { width: ${size}px; height: ${size}px; border-radius: ${radius}px; display: grid; place-items: center;
  background: linear-gradient(160deg, ${BRAND_LIGHT} 0%, ${BRAND} 70%); }
.h { font-family: M; font-weight: 800; color: #fff; font-size: ${Math.round(size * scale)}px; line-height: 1;
  transform: translateY(-2%); letter-spacing: -0.02em; }
</style></head><body><div class="i"><span class="h">H</span></div></body></html>`;
}

const targets = [
  { file: "public/icons/icon-192.png", size: 192, full: false, scale: 0.6 },
  { file: "public/icons/icon-512.png", size: 512, full: false, scale: 0.6 },
  // Maskable: the whole canvas is painted, the mark stays inside the 80% safe circle.
  { file: "public/icons/maskable-512.png", size: 512, full: true, scale: 0.46 },
  { file: "public/icons/maskable-192.png", size: 192, full: true, scale: 0.46 },
  // iOS draws its own rounded corners and needs an opaque image.
  { file: "public/icons/apple-touch-icon.png", size: 180, full: true, scale: 0.56 },
  { file: "favicon-32", size: 32, full: false, scale: 0.66 },
  { file: "favicon-48", size: 48, full: false, scale: 0.66 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
mkdirSync(path.join(ROOT, "public/icons"), { recursive: true });
const ico = [];
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(html(t.size, t));
  await page.evaluate(async () => {
    await document.fonts.load("800 100px M");
    await document.fonts.ready;
  });
  const png = await page.locator(".i").screenshot({ omitBackground: !t.full });
  if (t.file.startsWith("favicon")) ico.push({ size: t.size, png });
  else writeFileSync(path.join(ROOT, t.file), png);
}
await browser.close();

// ICO container with embedded PNGs (supported by every current browser).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(ico.length, 4);
let offset = 6 + 16 * ico.length;
const entries = ico.map(({ size, png }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0);
  e.writeUInt8(size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
writeFileSync(path.join(ROOT, "src/app/favicon.ico"), Buffer.concat([header, ...entries, ...ico.map((i) => i.png)]));
console.log("icons written");

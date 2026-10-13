import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;

export async function snap(page: Page, stage: string, name: string) {
  const dir = `screenshots/${stage}`;
  mkdirSync(dir, { recursive: true });
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Wait until the page has re-laid out for the new width (charts re-measure via ResizeObserver): a full-page shot
    // taken too early keeps the previous width (a «390» file came out 576px wide). Real overflow still shows up.
    await page
      .waitForFunction((w) => window.innerWidth === w && document.documentElement.scrollWidth <= w, vp.width, { timeout: 3000 })
      .catch(() => undefined);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/${name}-${vp.name}.png`, fullPage: true });
  }
}

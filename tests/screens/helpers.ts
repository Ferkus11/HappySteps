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
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/${name}-${vp.name}.png`, fullPage: true });
  }
}

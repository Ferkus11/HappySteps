import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { PHONES, login } from "./helpers";

/**
 * Accessibility (SPEC §8: «Сенсорные элементы ≥ 44px. Контраст текста по WCAG AA»).
 * axe-core on the main screens of every role, at 1440 (desktop) and at 390 with a touch screen, plus our own
 * 44×44 px check for every control on the touch layout (axe's `target-size` only asks for 24 px).
 *
 * Rules consciously not run (each one documented):
 * - `color-contrast-enhanced` — AAA (7:1), the SPEC asks for AA.
 * - `region` — content outside landmarks: toasts (sonner), dialogs and the install sheet are portals by design;
 *   the page itself is header / nav / main (checked by `landmark-*` rules).
 */

const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const DISABLED_RULES = ["color-contrast-enhanced", "region"];

/** Detail pages: the first link of each kind found on the role's screens. */
const DETAIL = /^\/(children|groups|staff|announcements|chats|payments|clubs|waitlist|worktime\/people|documents\/child|documents\/staff)\/[0-9a-f-]{36}$/;

const SCREENS: { role: string; phone: string; paths: string[]; dialogs?: [path: string, testId: string][] }[] = [
  {
    role: "owner",
    phone: PHONES.owner,
    paths: ["/", "/children", "/groups", "/staff", "/attendance", "/worktime", "/worktime/timesheet", "/menu", "/announcements", "/events", "/chats", "/documents", "/payments", "/clubs", "/waitlist", "/analytics", "/audit", "/settings", "/notifications", "/profile"],
    dialogs: [
      ["/children", "add-child"],
      ["/staff", "add-staff"],
      ["/announcements", "new-announcement"],
      ["/events", "new-event"],
      ["/clubs", "add-club"],
      ["/waitlist", "wl-add"],
    ],
  },
  { role: "head", phone: PHONES.head, paths: ["/", "/attendance/report", "/menu/edit"] },
  { role: "accountant", phone: PHONES.accountant, paths: ["/", "/payments?tab=month", "/payments?tab=debtors", "/analytics?tab=finance"] },
  { role: "teacher", phone: PHONES.teacher, paths: ["/", "/attendance", "/announcements", "/chats", "/worktime"] },
  { role: "club_teacher", phone: PHONES.clubTeacher, paths: ["/", "/clubs"] },
  { role: "cook", phone: PHONES.cook, paths: ["/", "/menu", "/menu/edit"] },
  {
    role: "parent",
    phone: PHONES.parent,
    paths: ["/", "/payments", "/clubs", "/documents", "/events", "/chats", "/profile"],
    dialogs: [
      ["/", "report-absence"],
      ["/chats", "new-chat"],
    ],
  },
  { role: "superadmin", phone: PHONES.superadmin, paths: ["/admin"] },
];

interface Finding {
  rule: string;
  impact: string | null;
  target: string;
  summary: string;
}

async function axe(page: Page): Promise<Finding[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ([tags, disabled]) => {
      const w = window as unknown as {
        axe: {
          run: (
            ctx: unknown,
            opts: unknown,
          ) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[]; failureSummary?: string }[] }[] }>;
        };
      };
      const r = await w.axe.run(document, {
        runOnly: { type: "tag", values: tags },
        rules: Object.fromEntries((disabled as string[]).map((id) => [id, { enabled: false }])),
        resultTypes: ["violations"],
      });
      return r.violations.flatMap((v) =>
        v.nodes.map((n) => ({ rule: v.id, impact: v.impact, target: n.target.join(" "), summary: (n.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim() })),
      );
    },
    [TAGS, DISABLED_RULES] as const,
  );
}

/**
 * Controls smaller than 44×44 px on the touch layout. Not counted: a control inside a bigger tap area that does the
 * same thing (a checkbox in its 44 px label row), a link inside a sentence (WCAG 2.5.8 inline exception),
 * hidden native inputs behind a styled label, and disabled controls.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const MIN = 44 - 0.5;
    const out: string[] = [];
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [role=radio], summary";
    const big = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width >= MIN && r.height >= MIN;
    };
    const name = (el: Element) => {
      const id = el.getAttribute("data-testid");
      const label = el.getAttribute("aria-label") ?? (el as HTMLElement).innerText?.trim().slice(0, 30) ?? "";
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""} «${label}»`;
    };
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const h = el as HTMLElement;
      if (h.closest("[aria-hidden=true], [inert]") || (h as HTMLButtonElement).disabled) continue;
      if (!h.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) || !h.getClientRects().length) continue;
      const r = h.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // visually hidden (sr-only) native input, operated through its label
      if (big(h)) continue;
      // Same action through a bigger wrapper: label row, clickable card.
      const wrap = h.parentElement?.closest("label, a[href], button, [role=button], [data-tap-area]");
      if (wrap && big(wrap)) continue;
      // Inline link in running text.
      if (h.tagName === "A" && getComputedStyle(h).display === "inline" && /\S/.test(h.parentElement?.textContent?.replace(h.textContent ?? "", "") ?? "")) continue;
      out.push(`${name(h)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return [...new Set(out)];
  });
}

async function settle(page: Page) {
  await page.waitForLoadState("load");
  await expect(page.locator("[data-skeleton]")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(200);
}

async function phonePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    serviceWorkers: "block",
  });
  return ctx.newPage();
}

for (const s of SCREENS) {
  test(`a11y · ${s.role}: axe (AA, 1440 and 390) and 44 px touch targets`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    const phone = await phonePage(browser);
    try {
      await login(page, s.phone);
      await login(phone, s.phone);
      const details = new Map<string, string>();
      const visit = async (p: string) => {
        for (const [label, pg] of [["1440", page], ["390", phone]] as const) {
          await pg.goto(p);
          await settle(pg);
          for (const f of await axe(pg)) problems.push(`${label} ${p} — ${f.rule} (${f.impact}) ${f.target} ${f.summary}`);
        }
        for (const t of await smallTargets(phone)) problems.push(`390 ${p} — touch target < 44px: ${t}`);
      };
      for (const p of s.paths) {
        await visit(p);
        for (const h of await page.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
          if (!DETAIL.test(h)) continue;
          const kind = h.replace(/\/[0-9a-f-]{36}$/, "");
          if (!details.has(kind)) details.set(kind, h);
        }
      }
      for (const p of details.values()) await visit(p);
      for (const [p, id] of s.dialogs ?? []) {
        for (const [label, pg] of [["1440", page], ["390", phone]] as const) {
          await pg.goto(p);
          await settle(pg);
          const trigger = pg.getByTestId(id).first();
          if (!(await trigger.isVisible())) continue;
          await trigger.click();
          await expect(pg.getByRole("dialog")).toBeVisible();
          await pg.waitForTimeout(300); // open animation
          for (const f of await axe(pg)) problems.push(`${label} ${p} [${id}] — ${f.rule} (${f.impact}) ${f.target} ${f.summary}`);
          if (label === "390") for (const t of await smallTargets(pg)) problems.push(`390 ${p} [${id}] — touch target < 44px: ${t}`);
        }
      }
    } finally {
      await phone.context().close();
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

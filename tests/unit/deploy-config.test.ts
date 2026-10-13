import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

type Job = { path: string; schedule: string };
const byPath = (a: Job, b: Job) => a.path.localeCompare(b.path);

const vercel = JSON.parse(read("vercel.json")) as { $schema?: string; crons?: Job[] };
const routes = readdirSync(join(root, "src/app/api/cron")).filter((d) => statSync(join(root, "src/app/api/cron", d)).isDirectory());

/** Jobs of the pg_cron template — the source of truth for schedules (D-036). */
const sqlJobs: Job[] = [...read("supabase/cron/schedule.sql").matchAll(/cron\.schedule\('hs-[a-z-]+',\s*'([^']+)',\s*\$\$select hs_cron\.call\('([^']+)'\)\$\$\)/g)]
  .map((m) => ({ path: m[2], schedule: m[1] }))
  .sort(byPath);

describe("cron schedules: supabase/cron/schedule.sql is the source of truth (D-036)", () => {
  it("every /api/cron route is scheduled in schedule.sql, and nothing else", () => {
    expect(sqlJobs.map((j) => j.path)).toEqual(routes.map((r) => `/api/cron/${r}`).sort());
    expect(new Set(sqlJobs.map((j) => j.path)).size).toBe(sqlJobs.length);
  });

  it("docker cron container (self-hosting) uses the same schedules", () => {
    const lines = read("docker/cron/crontab")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    const jobs = lines.map((l) => {
      const parts = l.trim().split(/\s+/);
      return { path: parts[parts.length - 1], schedule: parts.slice(0, 5).join(" ") };
    });
    expect(jobs.sort(byPath)).toEqual(sqlJobs);
  });

  it("vercel.json has no crons by default (Vercel Hobby rejects sub-daily jobs); if a Pro deployment adds them, they match", () => {
    expect(vercel.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    if (vercel.crons) expect([...vercel.crons].sort(byPath)).toEqual(sqlJobs);
    else expect(vercel.crons).toBeUndefined();
  });
});

describe(".env.example", () => {
  // Read by the code but deliberately not part of a deployment: set by platforms, tests or the local stack.
  const notDeployed = new Set(["NODE_ENV", "CI", "VERCEL", "E2E_PORT", "E2E_SW", "PW_CHROMIUM_PATH", "NEXT_PUBLIC_ENABLE_SW"]);

  function walk(dir: string): string[] {
    return readdirSync(join(root, dir)).flatMap((n) => {
      const p = join(dir, n);
      return statSync(join(root, p)).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
    });
  }

  it("documents every variable the app reads", () => {
    const used = new Set<string>();
    for (const f of walk("src")) {
      for (const m of read(f).matchAll(/process\.env\.([A-Z0-9_]+)|required\("([A-Z0-9_]+)"\)|env\.([A-Z0-9_]+)/g)) used.add(m[1] ?? m[2] ?? m[3]);
    }
    const documented = new Set([...read(".env.example").matchAll(/^#?\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]));
    const missing = [...used].filter((v) => !notDeployed.has(v) && !documented.has(v));
    expect(missing).toEqual([]);
  });
});

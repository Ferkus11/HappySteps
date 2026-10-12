# Guide for module agents

You build one module of Happy Steps in your own git worktree. The foundation (tenancy, roles, RLS
helpers, auth, shell, design system, i18n, tests) is done — **reuse it, don't rebuild it**.
Read `SPEC.md` (sections 3, 5, 6, 8, 11, 13 at least) and `DECISIONS.md` first.

## 0. Hard rules (SPEC §0)
- Never weaken RLS policies or role checks to make a test pass. Never edit
  `supabase/migrations/2026101210*_foundation.sql` or `2026101309*_shared_base.sql`.
- No secrets in code. TypeScript strict stays on. `npm run lint` has `--max-warnings=0`.
- Touch only your module's files plus the explicit *registration points* in §6.
- Next.js here is **16.x** — APIs differ from your training data. Before using a Next API you are not
  sure about, read the relevant file in `node_modules/next/dist/docs/` (proxy.ts instead of middleware,
  async `params`/`searchParams`/`cookies()`, etc.).
- Do not call any `mcp__hearthbot__*` tool and do not push. Commit to your worktree branch only.

## 1. Worktree setup (once)
```bash
scripts/worktree-setup.sh <SLOT> /home/claude/happy-steps   # SLOT is given in your brief (1..9)
```
This symlinks `node_modules`, starts an independent local Supabase stack (own database, own ports),
writes `.env.local`, and seeds the e2e fixtures. Re-run it after adding/changing your migration
(it resets the DB). Run e2e on your own port: `E2E_PORT=$((3100 + 10*SLOT)) npm run e2e`.
Start long-running commands with output redirected to a file (e.g. `> /tmp/x.log 2>&1`), never in
the foreground without redirection.

## 2. Database
- One migration file: `supabase/migrations/<your prefix>_<module>.sql` (prefix from your brief).
- Every table: `kindergarten_id uuid not null references kindergartens(id) on delete cascade`,
  RLS enabled, explicit policies per command. `tests/rls/coverage.test.ts` fails if RLS is off and
  `foundation.test.ts` automatically checks cross-tenant isolation for every table with `kindergarten_id`.
- Use the helpers (all `security definer`, already honour archived memberships and blocked gardens):
  `is_member(kg)`, `is_staff(kg)`, `is_admin(kg)` (owner/head), `has_role(kg, array['accountant']::app_role[])`,
  `teaches_group(group_id)`, `teaches_child(child_id)`, `is_guardian(child_id)`, `child_visible(child_id)`,
  `child_group_on(child_id, date)`, `kg_today(kg)`, `kg_now(kg)` (local timestamp), `kg_is_working_day(kg, date)`,
  `kitchen_allergies(kg)`, `log_action(kg, action, entity, entity_id, details)`.
- When a row references another tenant row (group, child, user), add a trigger that checks the
  referenced row has the same `kindergarten_id` (see `tg_same_kg_*` in the foundation migration).
- New `security definer` functions: `set search_path = public`, check the caller inside the function,
  and `revoke execute ... from public, anon` unless anon really needs it.
- Column-level write restrictions: `revoke update on t from authenticated; grant update (cols) ...`.
- Settings already present in `kindergarten_settings`: `timezone`, `late_threshold_minutes`,
  `attendance_reminder_time`, `attendance_escalation_time`, `meals text[]`, `payment_due_day`,
  `quiet_hours_*`, `default_locale`. Kindergarten days off: table `holidays` (+ `kg_is_working_day`).
- Storage: buckets are private and only the service role touches them. Upload in a server action
  **after** checking permission, path `<kindergarten_id>/<entity>/<uuid>.<ext>`, read through
  `signedUrl(s)` from `src/lib/kg-assets.ts` (short expiry). Create your bucket in your migration:
  `insert into storage.buckets (id, name, public) values ('x', 'x', false) on conflict do nothing;`

## 3. Server code
- Pages: `src/app/(app)/<module>/page.tsx` (Server Components). Guard with
  `const ctx = await requireKg(["owner", ...])` from `@/lib/auth/context` (redirects otherwise).
  `ctx.kg`, `ctx.settings`, `ctx.role` (current role), `ctx.roles` (all roles in this garden), `ctx.userId`.
  Read data with `await createClient()` from `@/lib/supabase/server` — RLS applies.
- Mutations: server actions in `actions.ts` with `"use server"`, wrapped in
  `kgAction([roles], async (ctx, supabase) => { const v = parse(schema, input); check(await supabase...) })`
  from `@/lib/actions/safe`. Throw `new ActionError("code")` for business errors; add the code to
  `messages/*/errors.json` only if no existing code fits (`forbidden`, `invalid`, `notFound`, `duplicate`, `inUse`, `generic`, … see `src/lib/actions/result.ts` for the Postgres error mapping). SQL functions/triggers raise business errors as `raise exception 'hs:<errorKey>'` and the key is shown translated..
  Validate with zod + helpers in `@/lib/validation` (`zDate`, `zTime`, `zUuid`, `zMoney`, `zOptionalText`).
- Sensitive actions → `audit(supabase, ctx.kg.id, "<module>.<verb>", entity, id, details)` (`@/lib/audit`);
  add the label for the action to `messages/{ru,kk}/audit.json` (`actions.<module>.<verb>` may already exist).
- Notifications: `notify({ kindergartenId, userIds, type, params, url })` from `@/lib/notify` **after**
  your own permission checks. Types are fixed in `NOTIFICATION_TYPES`; texts live in
  `messages/*/notifications.json` (`types.<type>.title/body`, ICU params). Push delivery comes in stage 6.
- Cron jobs: `src/app/api/cron/<job>/route.ts`, `GET`, first line
  `const denied = cronUnauthorized(req); if (denied) return denied;` (`@/lib/cron`), then work with the
  service client per kindergarten in its own time zone. Must be idempotent (runs every 5–15 min).
  Add the schedule to `vercel.json` `crons` (create the file if missing).
- Exports: route handler `src/app/(app)/<module>/export/route.ts` that calls `loadContext()` and checks
  roles itself; `.xlsx` via `exceljs`, `.pdf` via `pdfkit`.
- Dates/times: always in the kindergarten time zone — `todayIn(ctx.settings.timezone)`, `formatDate`
  (`12.10.2026`), `formatTime` (24h), `formatMoney` from `@/lib/format`.

## 4. UI
- Reuse `src/components/ui/*`: `Button`, `Card`/`CardHeader`, `Input`/`Textarea`/`Select`/`Label`/`Field`,
  `Badge`, `Skeleton`, `EmptyState`, `Ring`, `Stat`/`StatusTile`, `PageHeader`, `Dialog` (bottom sheet on
  phones), `Dropdown*`, `Tabs`, `Switch`/`Checkbox`, `Avatar`, `PhoneInput`; common: `Confirm`,
  `InviteLink`. Look at `/styleguide` and existing pages (`groups`, `children`, `staff`) for patterns.
- Client mutations: `const a = useAction(myAction, { success: t("saved") }); a.run(input)` (`@/hooks/use-action`)
  — handles errors/toasts/offline/refresh.
- SPEC §8: one primary action per screen, big numbers + small captions, ≥44px touch targets, empty states
  with icon + hint, skeletons (`loading.tsx`), phone first (390px) and desktop (1440px). No red except errors/debts.
- `data-testid` on things tests click or read.
- **i18n:** no hard-coded strings. Namespace `<module>` → `src/messages/{ru,kk}/<module>.json` with
  identical keys, ICU plurals (`{count, plural, one {...} few {...} many {...} other {...}}` for ru;
  `one`/`other` for kk). Kazakh must be real Kazakh (no ё/щ/ъ; `tests/unit/i18n.test.ts` enforces parity
  and flags ru==kk copies). User content is not translated.

## 5. Tests (all must be green before you finish)
- `tests/rls/<module>.test.ts` — per-role visibility and write rules, using `asUser`, `inTx`/`become`,
  `rejects` from `tests/rls/db.ts` and fixtures `fx()`/`PHONES` from `tests/rls/fixtures.ts`.
  Cover: other garden invisible, parent sees only own children, teacher only own groups, forbidden writes.
- `tests/e2e/<NN>-<module>.spec.ts` (NN from your brief) — the SPEC §13 scenarios assigned to you plus a
  smoke path per role. Helpers: `login`, `PHONES`, `randomPhone` in `tests/e2e/helpers.ts`. Tests must be
  re-runnable on the same DB: create the data they need or clean up first.
- `tests/screens/stage<N>-<module>.spec.ts` — `snap(page, "stage<N>", "<module>-<role>-<screen>")` for the
  key screens of each role (390 + 1440). **Look at the PNGs** (Read tool) and fix visual problems.
- Unit tests for pure logic (`tests/unit/*.test.ts`).
- Fixtures (password `Test1234!`): garden A `e2e-a` — owner +77010000001, head …02, accountant …03,
  teacher …04 (group Солнышко), club_teacher …05, cook …06, parent …07 (child Алихан, allergy орехи),
  teacher+parent …08 (teacher of Звёздочки, parent of Миша); garden B `e2e-b` — owner +77020000001,
  parent +77020000002; superadmin +77000000001. Extra module fixtures: add `scripts/seed/e2e-<module>.ts`
  exporting `seed<Module>(db, ids)` and call it from `scripts/seed/e2e.ts` (one line).
- Full check: `npm run typecheck && npm run lint && npm test && npm run test:rls && npm run build && E2E_PORT=... npm run e2e`
  then `E2E_PORT=... npm run screens -- tests/screens/stage<N>-<module>.spec.ts`.

## 6. Registration points (expect trivial merge conflicts here — keep edits to one line each)
- `src/messages/index.ts` — add your namespace.
- `src/components/dashboard/widgets.tsx` — `...<module>Widgets` exported from
  `src/components/<module>/widgets.tsx` (`DashboardWidget[]`, slots `top` / `stat` / `main`, filter by role).
- `src/app/(app)/settings/sections.tsx`, `src/app/(app)/profile/sections.tsx` — extra cards.
- `src/lib/nav.ts` — routes for all modules already exist; change only if your module needs it.
- `scripts/seed/e2e.ts` — one call to your seed function.
- `vercel.json` — your cron entry.

## 7. Finish
Commit in your worktree (`git add -A && git commit`, message `Stage <N><letter>: <module>`). Your final
answer must list: files/tables created, decisions taken (each as a candidate `DECISIONS.md` entry),
test counts per suite, screenshots produced, and anything left undone or questionable.

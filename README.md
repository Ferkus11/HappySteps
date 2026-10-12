# Happy Steps

Платформа управления детским садом (SaaS + PWA). ТЗ — `SPEC.md`, план — `PLAN.md`,
прогресс — `PROGRESS.md`, решения — `DECISIONS.md`.

Полная инструкция по запуску и деплою появится на этапе 7.

```bash
npm install
npm run db:start      # локальный Supabase (без Docker) → .env.local
npm run dev
npm run verify        # typecheck, lint, unit, RLS, build, e2e
```

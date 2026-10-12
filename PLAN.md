# PLAN — Happy Steps

План составлен по SPEC.md (разделы 0 и 12). Каждый этап закрывается проверочным циклом
`typecheck → lint → unit → RLS → e2e → build → скриншоты 390/1440 → коммит`.
Команда цикла: `npm run verify` (скриншоты: `npm run screens`).

## Архитектура (кратко)
- Next.js 16 (App Router, TS strict), Tailwind v4, компоненты в стиле shadcn/ui на Radix, lucide-react.
- Supabase: Postgres + RLS (изоляция по `kindergarten_id`), Auth (GoTrue), Storage (приватные бакеты),
  Realtime (`postgres_changes` для чатов). Только возможности, которые есть в self-hosted Supabase.
- Чтение — Server Components через supabase-js с JWT пользователя (RLS). Запись — Server Actions:
  zod-валидация → проверка прав (SQL-функции `has_role(...)`) → запрос от имени пользователя (RLS ещё раз).
  Service role — только для Auth admin API, Storage и cron, всегда после явной проверки прав.
- Сложная бизнес-логика в SQL-функциях (статусы дня, порции, начисления), чтобы RLS, cron и UI считали одинаково.
- Cron: `/api/cron/*` с `CRON_SECRET` (Vercel Cron в облаке, системный cron/контейнер в self-hosted).
- Локально без Docker: `scripts/local-supabase` поднимает Postgres 16 + GoTrue + PostgREST + шлюз
  (эмуляция Storage/Realtime). С Docker — обычный `supabase start` по тем же миграциям.

## Этап 0 — Каркас
1. Next.js, отключить cacheComponents, strict TS, ESLint, Prettier-подобные правила через ESLint.
2. Дизайн-токены Happy Steps (CSS-переменные, акцент настраивается на сад), шрифт Manrope (kk-кириллица).
3. UI-кит: Button, Card, Input, Label, Select, Dialog, Sheet, Tabs, Badge, Skeleton, Switch, Toast (sonner), EmptyState, Ring, StatTile.
4. i18n: next-intl без префикса в URL (язык в cookie/профиле), `messages/ru.json`, `messages/kk.json`, проверка полноты ключей тестом.
5. Layout: телефон — нижняя панель (4–5 пунктов по роли), десктоп — сайдбар + шапка.
6. Supabase: `supabase/config.toml`, `supabase/migrations`, клиенты (browser/server/service), локальный стек.
7. Тесты: Vitest (unit + RLS через pg с `set role authenticated` + JWT claims), Playwright (e2e + скриншоты).
8. Скрипты: `typecheck`, `lint`, `test`, `test:rls`, `e2e`, `build`, `verify`, `screens`, `db:reset`, `db:seed`; GitHub Actions CI.

## Этап 1 — Фундамент
1. Схема: kindergartens, kindergarten_settings, profiles, memberships, invites, groups, group_teachers, children,
   child_guardians, child_group_history, audit_log, plans, subscriptions, holidays, login_attempts.
2. RLS-хелперы: `auth_kg_ids()`, `has_role(kg, roles[])`, `is_superadmin()`, `is_guardian_of(child)`, `teaches_group(group)`.
3. Вход по телефону + пароль (техн. email), лимит попыток, приглашения 72 ч (копировать / WhatsApp), сброс через администрацию.
4. Дубли номеров → добавление членства. Архив/восстановление/удаление (ввод названия), авто-архив родителя.
5. Переключатель сада/роли (cookie), согласие на обработку ПДн при первом входе.
6. Суперадмин: список садов, создание сада + владельца, блокировка, тариф/подписка до.
7. Сотрудники, группы (вместимость, цвет, перевод группы), дети (перевод с датой, история), родители (отвязка).
8. Журнал действий с фильтрами. Подписка: middleware-проверка `blocked`.
9. RLS-тесты по ролям, e2e сценарии 1, 9 (частично), 10, 11.

## Этап 2 — Ежедневные операции (4 субагента)
A. Учёт времени: графики, переопределения, отсутствия, праздники РК, сессии, статусы дня, автозакрытие, табель + xlsx/pdf.
B. Посещаемость: отметка, «Все пришли», пропуски от родителей, порции, правки задним числом, отчёт xlsx.
C. Меню: приёмы пищи, копирование дня, главная повара (порции, аллергии).
D. Объявления (аудитории, фото/PDF, «Важное», прочтения, «Напомнить») + календарь событий (дни рождения).
e2e: сценарии 2, 3, 4.

## Этап 3 — Коммуникации и деньги (3 субагента)
A. Чаты realtime (группа, личные, сотрудники, модерация, режим «только объявления», прочтения).
B. Документы детей и сотрудников (категории, сроки, HEIC→JPEG, подписанные URL).
C. Счета и чеки (начисление 1-го, корректировки, реквизиты, очередь, частичные/переплата, просрочка).
e2e: сценарии 5, 8.

## Этап 4 — Кружки и приём (2 субагента)
A. Кружки: каталог по возрасту, заявки, очередь, подтверждение, отписка/исключение.
B. Лист ожидания: публичная форма (honeypot + rate limit), статусы, комментарии, «Принять».
e2e: сценарии 6, 7.

## Этап 5 — Дашборды и аналитика
Главные по ролям (раздел 6), аналитика владельца (раздел 7) с периодами и сравнением, экспорты xlsx (субагент).
Карточка «Требует внимания» у владельца/заведующей: неотмеченные группы, чеки на проверке, заявки в кружки, истекающие документы.

## Этап 6 — Уведомления и PWA
Web Push (VAPID), колокольчик, настройки типов, тихие часы, manifest + service worker, офлайн-баннер,
инструкция iOS, cron-напоминания (посещаемость 10:00/11:00, события, документы, автозакрытие, начисления).

## Этап 7 — Полировка и сдача
Полный kk, доступность (44px, контраст AA), UX-ревью субагентом, скриншоты всех ролей, seed «Happy Steps»,
README (локально, Vercel + Supabase Cloud, self-hosted), `docs/self-hosting.md`, docker-compose, Dockerfile,
e2e сценарий 12, итоговый прогон всех сценариев раздела 13.

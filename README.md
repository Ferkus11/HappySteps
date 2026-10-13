# Happy Steps

Платформа для частных детских садов Казахстана: веб-приложение + PWA на телефоне. Собирает жизнь сада
в одном месте — дети и группы, посещаемость, учёт рабочего времени, меню, объявления, события, чаты,
документы, оплата по чекам, кружки, лист ожидания и аналитика владельца. Один аккаунт = один номер телефона,
можно состоять в нескольких садах и ролях. Интерфейс на русском и казахском.

Документы проекта: ТЗ — [`SPEC.md`](SPEC.md), план — [`PLAN.md`](PLAN.md), состояние — [`PROGRESS.md`](PROGRESS.md),
принятые решения — [`DECISIONS.md`](DECISIONS.md), правила для разработчиков-агентов — [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md).

**Содержание:** [Возможности](#возможности-по-ролям) · [Демо](#демо) · [Локальный запуск](#локальный-запуск) ·
[Переменные окружения](#переменные-окружения) · [Тесты](#тесты) · [Деплой: Vercel + Supabase Cloud](#деплой-vercel--supabase-cloud) ·
[Первый суперадмин](#первый-суперадмин) · [Фоновые задачи (cron)](#фоновые-задачи-cron) · [Свой сервер](#свой-сервер-self-hosting) ·
[Структура](#структура-проекта)

---

## Возможности по ролям

| Роль | Что делает |
|---|---|
| **Суперадмин платформы** | Создаёт сады и первого владельца (ссылка-приглашение), блокирует сад, задаёт тариф и срок подписки. |
| **Владелец** | Всё в своём саду: сотрудники и их роли, дети и группы, оплаты, аналитика (посещаемость, финансы, персонал), журнал действий, настройки сада (название, логотип, цвет, часовой пояс, тихие часы, текст согласия). |
| **Заведующая** | Ежедневное управление: воспитатели, повара, педагоги кружков, дети и родители, посещаемость, меню, объявления, события, лист ожидания. |
| **Бухгалтер** | Счета и проверка чеков, табель рабочего времени, финансовая аналитика, выгрузки в Excel/PDF. |
| **Воспитатель** | Отметка посещаемости своей группы, сообщения о пропусках от родителей, объявления и события группы, чаты с родителями, приход/уход на работу. |
| **Педагог кружка** | Свои кружки, заявки и очередь, учёт времени. |
| **Повар** | Меню на день, число порций по факту посещаемости, аллергии детей. |
| **Родитель** | Свои дети: посещаемость и «сообщить о пропуске», меню, объявления, события, чат с воспитателем, документы, счета и загрузка чеков, запись в кружки. |

Общее: вход по телефону и паролю (без SMS; аккаунты создаёт администрация и отправляет ссылку в WhatsApp),
уведомления в приложении и Web Push, тихие часы, установка на телефон как приложение (PWA), просмотр без сети.
Публичная анкета для листа ожидания (`/apply/<сад>`) с QR-кодом.

Скриншоты всех ролей делаются командой `npm run screens` (папка `screenshots/`, в git не хранится).

## Демо

Демо-сад «Happy Steps» с данными за 3 месяца создаётся командой `npm run db:seed`.
**Логины и пароли для каждой роли — в [`docs/demo.md`](docs/demo.md).**

---

## Локальный запуск

Нужно: **Node.js 22** и npm. Затем один из двух вариантов базы.

```bash
git clone <адрес репозитория> happy-steps && cd happy-steps
npm ci
```

### Вариант А — без Docker (как в CI): `npm run db:start`

Работает на Linux (Debian/Ubuntu) с установленным **PostgreSQL 16** (пароль пользователя `postgres` — `postgres`):

```bash
sudo apt install postgresql-16       # если ещё нет
npm run db:start      # скачает GoTrue и PostgREST, применит миграции, запишет .env.local
npm run db:seed       # демо-сад Happy Steps (логины — в docs/demo.md)
npm run dev           # http://localhost:3000
```

`npm run db:reset` — пересоздать базу с нуля, `scripts/local-supabase/stop.sh` — остановить.
Это облегчённый стек: Storage и Realtime эмулирует маленький шлюз (`scripts/local-supabase/gateway.mjs`).

### Вариант Б — официальный Supabase CLI с Docker

Нужен Docker. Supabase CLI ставить в проект не нужно — запускайте через `npx`:

```bash
npx supabase@latest start            # поднимет Supabase в Docker и применит supabase/migrations
npx supabase@latest status -o env    # покажет адреса и ключи
```

Создайте `.env.local` из `.env.example` и подставьте значения из `status`:

| В `.env.local` | Из `supabase status -o env` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` (обычно `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |
| `SUPABASE_DB_URL` | `DB_URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) |

и допишите `CRON_SECRET` (`openssl rand -hex 32`) и ключи VAPID (`npx web-push generate-vapid-keys`). Затем
`npm run db:seed` и `npm run dev`. Studio (админка базы) — http://127.0.0.1:54323. Остановить: `npx supabase@latest stop`.

> Проверено: все миграции применяются чисто реальным Supabase CLI 2.120 (`supabase db start`, Postgres 17).

---

## Переменные окружения

Полный список с комментариями — [`.env.example`](.env.example). 🔒 — секрет: не показывать, не коммитить.
`NEXT_PUBLIC_*` попадают в браузер и **вшиваются при сборке** — после изменения нужна пересборка (Redeploy).

| Переменная | Зачем | Секрет |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Адрес API Supabase (`https://<ref>.supabase.co` или `https://api.ваш-домен`) | нет |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Публичный anon-ключ; права ограничены RLS | нет |
| `SUPABASE_SERVICE_ROLE_KEY` | Серверный ключ, обходит RLS (создание пользователей, файлы, cron) | 🔒 |
| `APP_URL` | Публичный адрес приложения: ссылки-приглашения, push, QR анкеты | нет |
| `AUTH_EMAIL_DOMAIN` | Технический домен логинов `<телефон>@<домен>` (D-004). **Не менять после запуска** | нет |
| `CRON_SECRET` | Пароль для вызова `/api/cron/*` | 🔒 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Публичный ключ Web Push | нет |
| `VAPID_PRIVATE_KEY` | Закрытый ключ Web Push | 🔒 |
| `VAPID_SUBJECT` | Контакт для push-сервисов, `mailto:...` | нет |
| `TRUSTED_PROXY_HOPS` | Сколько прокси перед приложением (для IP в лимитах входа и анкеты). Свой сервер с Caddy — `1`; на Vercel не нужен | нет |
| `SUPABASE_DB_URL` | Прямое подключение к Postgres — только тесты и seed | 🔒 |
| `PUSH_ALLOW_LOCAL_ENDPOINTS` | Только для e2e: разрешить push на localhost | — |
| `NEXT_PUBLIC_ENABLE_SW` | `0` — выключить service worker в сборке (по умолчанию включён в production) | нет |

Только для скриптов: `SUPERADMIN_PASSWORD` ([первый суперадмин](#первый-суперадмин)),
`SOURCE_*`/`TARGET_*` ([перенос файлов](docs/self-hosting.md#6-переезд-с-supabase-cloud)).
Только для docker compose: `APP_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL` ([docs/self-hosting.md](docs/self-hosting.md)).

---

## Тесты

```bash
npm run typecheck      # TypeScript strict
npm run lint           # ESLint, 0 предупреждений
npm test               # unit (Vitest)
npm run test:rls       # права доступа на реальной базе (нужен запущенный стек)
npm run build          # production-сборка (standalone)
npm run db:seed -- --e2e && npm run e2e   # сценарии Playwright на собранном приложении
npm run screens        # скриншоты 390px и 1440px для всех ролей → screenshots/
npm run verify         # всё сразу: typecheck, lint, unit, RLS, build, e2e
```

Перед первым e2e: `npx playwright install chromium`. CI — [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Деплой: Vercel + Supabase Cloud

Это вариант для **демо и разработки** (только тестовые данные). Реальные данные детей по закону РК хранятся
на сервере в Казахстане — см. [свой сервер](#свой-сервер-self-hosting).

Понадобятся аккаунты: **GitHub** (репозиторий), **Supabase** (supabase.com), **Vercel** (vercel.com).

### 1. Проект Supabase

1. supabase.com → **New project**. Регион — ближайший (например, Frankfurt `eu-central-1`). Запишите пароль базы.
2. Узнайте **Project ref** — это `xxxx` в адресе `https://xxxx.supabase.co` (Project Settings → General).

### 2. Миграции базы

На своём компьютере в папке проекта:

```bash
npx supabase@latest login                          # откроет браузер, войдите в Supabase
npx supabase@latest link --project-ref <ref>       # спросит пароль базы из шага 1
npx supabase@latest db push                        # применит все файлы supabase/migrations
```

Бакеты Storage (фото, документы, чеки и т. д., все приватные) создаются самими миграциями — вручную ничего
создавать не нужно. Проверка: Dashboard → Storage — 8 бакетов; Table Editor — таблицы `kindergartens`, `profiles`, …

Позже, при обновлениях, повторяйте только `npx supabase@latest db push`.

### 3. Настройки Auth в Supabase

Dashboard → **Authentication**:

- **Sign In / Providers → Email**: провайдер включён, **Confirm email — выключить** (логины технические,
  писем никто не получит), **Allow new users to sign up — выключить** (аккаунты создаёт только администрация).
  Минимальная длина пароля — 8.
- **Phone** — не нужен (вход по телефону сделан через технический e-mail, SMS не используются).
- **URL Configuration**: *Site URL* = адрес приложения на Vercel (например, `https://happy-steps.vercel.app`),
  *Redirect URLs* — тот же адрес с `/**`. После подключения своего домена — поменять на него.

### 4. Ключи

Dashboard → **Project Settings → API Keys** → вкладка **Legacy API keys**: `anon` (публичный) и `service_role` (🔒).
С новыми ключами `sb_publishable_…`/`sb_secret_…` приложение тоже должно работать, но проверено на legacy-ключах.

Сгенерируйте остальные секреты (на своём компьютере, в папке проекта после `npm ci`):

```bash
openssl rand -hex 32                 # → CRON_SECRET
npx web-push generate-vapid-keys     # → Public Key = NEXT_PUBLIC_VAPID_PUBLIC_KEY, Private Key = VAPID_PRIVATE_KEY
```

Ключи VAPID сгенерируйте **один раз**: новая пара отключит все push-подписки.

### 5. Проект Vercel

1. vercel.com → **Add New → Project** → импортируйте репозиторий с GitHub.
2. Framework — **Next.js** (определится сам). Build Command `npm run build`, Install Command `npm ci`,
   Output — по умолчанию. **Settings → General → Node.js Version: 22.x**.
3. **Settings → Environment Variables** (окружение Production; для превью — Preview):

   ```
   NEXT_PUBLIC_SUPABASE_URL      = https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon>
   SUPABASE_SERVICE_ROLE_KEY     = <service_role>            (Sensitive)
   APP_URL                       = https://<проект>.vercel.app
   AUTH_EMAIL_DOMAIN             = users.happysteps.kz        (любой ваш домен; потом не менять)
   CRON_SECRET                   = <openssl rand -hex 32>     (Sensitive)
   NEXT_PUBLIC_VAPID_PUBLIC_KEY  = <Public Key>
   VAPID_PRIVATE_KEY             = <Private Key>              (Sensitive)
   VAPID_SUBJECT                 = mailto:support@<ваш-домен>
   ```

   `TRUSTED_PROXY_HOPS` на Vercel не нужен — IP берётся из заголовка Vercel. `SUPABASE_DB_URL` не нужен.
4. **Settings → Functions → Function Region** — тот же регион, что у Supabase (Frankfurt = `fra1`): страницы откроются быстрее.
5. **Deploy**. Проверка: `https://<проект>.vercel.app/api/health` → `{"ok":true}`, `/login` — экран входа.

Ограничение Vercel: тело запроса к функции — не больше 4,5 МБ, поэтому файлы крупнее (документы до 15 МБ)
на Vercel не загрузятся; на своём сервере этого ограничения нет.

### 6. Фоновые задачи

Напоминания о посещаемости, отложенные push, автозакрытие смен, начисление счетов и т. д. —
см. [Фоновые задачи (cron)](#фоновые-задачи-cron). Коротко: **Vercel Pro** — ничего делать не надо;
**Vercel Hobby** — уберите блок `crons` из `vercel.json` и выполните `supabase/cron/schedule.sql`.

### 7. Первый суперадмин и первый сад

1. Создайте суперадмина — [следующий раздел](#первый-суперадмин).
2. Войдите на `/login` его телефоном и паролем → **«Сады платформы»** → **«Создать сад»**: название, адрес-slug,
   ФИО и телефон владельца.
3. Скопируйте ссылку-приглашение (или «Отправить в WhatsApp») и отправьте владельцу. Он задаст пароль,
   дальше сам добавит сотрудников, группы, детей и родителей.
4. Для демо вместо этого можно залить демо-сад: `npm run db:seed` с переменными продакшена
   (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_EMAIL_DOMAIN`) в `.env.local`. Логины — в [docs/demo.md](docs/demo.md).

---

## Первый суперадмин

В продакшене суперадмина создаёт скрипт (локальные seed-данные создают своего). Он безопасен для повторного
запуска: если человек с таким телефоном уже есть — просто выдаёт ему права суперадмина.

```bash
npm ci   # один раз
export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role>
export AUTH_EMAIL_DOMAIN=<то же значение, что в Vercel>
npm run superadmin:create -- --phone "+7 701 000 00 00" --name "Имя Фамилия"
# пароль спросит в терминале (не отображается); или заранее: export SUPERADMIN_PASSWORD='...'
```

- Значения можно положить в `.env.local` — скрипт читает его сам (а также `.env`).
- `--reset-password` — сменить пароль существующему пользователю.
- `AUTH_EMAIL_DOMAIN` обязан совпадать со значением приложения — иначе вход не сработает.
- Альтернатива для уже существующего пользователя (SQL Editor):
  `insert into platform_admins (user_id) select id from profiles where phone = '+77010000000' on conflict do nothing;`

---

## Фоновые задачи (cron)

Маршруты `/api/cron/*` вызываются по расписанию с заголовком `Authorization: Bearer $CRON_SECRET`
(без него — 401). Все задачи идемпотентны: повторный вызов ничего не дублирует.

| Маршрут | Расписание (UTC) | Что делает |
|---|---|---|
| `/api/cron/attendance-reminders` | каждые 15 мин | Напоминание воспитателю «группа не отмечена», эскалация заведующей |
| `/api/cron/event-reminders` | каждый час в :05 | Напоминание аудитории события за день до него |
| `/api/cron/worktime-autoclose` | каждые 15 мин | Закрывает забытые смены (через 2 ч после конца смены) и уведомляет сотрудника |
| `/api/cron/document-expiry` | 03:00 | Документы сотрудников, истекающие через 30 и 7 дней |
| `/api/cron/invoices-accrue` | 01:00 | Счета за текущий месяц (начисление 1-го числа, в часовом поясе сада) |
| `/api/cron/push-deferred` | каждые 5 мин | Отправка push, отложенных тихими часами |

Источник расписания — [`vercel.json`](vercel.json); копии в `supabase/cron/schedule.sql` и `docker/cron/crontab`
сверяет unit-тест `tests/unit/deploy-config.test.ts`. Где запускать:

- **Vercel Pro** — `vercel.json` работает как есть: Vercel сам добавляет `CRON_SECRET` в заголовок.
- **Vercel Hobby** разрешает только ежедневные задачи, и деплой с частыми задачами не пройдёт (DECISIONS.md D-021).
  1. Удалите блок `"crons": [...]` из `vercel.json` (закоммитьте — Vercel пересоберёт).
  2. Supabase Dashboard → **SQL Editor** → вставьте [`supabase/cron/schedule.sql`](supabase/cron/schedule.sql),
     замените в начале `https://app.example.kz` на адрес приложения и `REPLACE_WITH_CRON_SECRET` на `CRON_SECRET` → **Run**.
     Расширения `pg_cron` и `pg_net` включаются самим скриптом. Секреты хранятся в **Supabase Vault**
     (зашифрованы, в тексте заданий их нет). Проверка и отключение — в комментариях файла.
- **Свой сервер** — контейнер `cron` в `docker-compose.yml` (busybox crond + wget), см. [docs/self-hosting.md](docs/self-hosting.md).

Проверить вручную: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<адрес>/api/cron/push-deferred` → `{"ok":true,...}`.

---

## Свой сервер (self-hosting)

Перед работой с реальными детьми платформа переезжает на собственный сервер в Казахстане (Supabase в Docker +
приложение в Docker + Caddy с HTTPS + cron). Пошагово, включая перенос данных из Supabase Cloud, резервные
копии, обновления и мониторинг: **[docs/self-hosting.md](docs/self-hosting.md)**.

```bash
cp .env.example .env    # заполнить
docker compose up -d --build
```

Образ приложения собирается из [`Dockerfile`](Dockerfile) (Next.js standalone, healthcheck `/api/health`).

---

## Структура проекта

```
src/
  app/(auth)/        вход, приглашение, согласие, блокировка
  app/(app)/<модуль> страницы модулей (children, attendance, worktime, menu, chats, payments, …, admin)
  app/api/cron/*     фоновые задачи;  app/api/health — проверка живости
  app/apply/[slug]   публичная анкета листа ожидания
  components/        ui/ (дизайн-система), shell/ (оболочка), <модуль>/
  lib/               логика, права, Supabase-клиенты, уведомления, push, форматирование
  messages/{ru,kk}/  переводы (next-intl)
  proxy.ts           проверка сессии и подписки (Next 16: proxy вместо middleware)
supabase/
  migrations/        схема БД, RLS, функции, бакеты Storage (применяются `supabase db push`)
  cron/schedule.sql  расписание через pg_cron (не миграция — запускается вручную)
  config.toml        для Supabase CLI
scripts/
  local-supabase/    локальный стек без Docker (`npm run db:start`)
  seed/              демо- и e2e-данные (`npm run db:seed`)
  create-superadmin.ts, storage-copy.ts
docker/              конфиги Caddy и cron для docker-compose.yml
tests/               unit/, rls/, e2e/, screens/
docs/                self-hosting.md, demo.md, AGENT_GUIDE.md
```

## Соглашения

- Каждое решение, которого нет в ТЗ, записывается в [`DECISIONS.md`](DECISIONS.md) (D-001…).
- Правила кода — [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md): RLS на каждой таблице и проверки ролей на сервере,
  никаких секретов в коде, TypeScript strict, все строки через i18n (ru + kk), новая миграция — отдельный файл.
- Next.js здесь 16.x: `proxy.ts` вместо middleware, асинхронные `params`/`cookies()`.
- После каждого этапа — `npm run verify` и коммит; состояние — в [`PROGRESS.md`](PROGRESS.md).

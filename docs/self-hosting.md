# Happy Steps на своём сервере (self-hosting)

Эта инструкция — для запуска с **реальными данными детей**: закон РК о персональных данных требует хранить их
на территории Казахстана, поэтому база, файлы и приложение работают на вашем сервере в РК.
Всё запускается в Docker; внешних облачных сервисов не нужно (кроме push-сервисов браузеров).

Содержание:
1. [Как это устроено](#1-как-это-устроено)
2. [Сервер, домены, Docker](#2-сервер-домены-docker)
3. [Supabase в Docker](#3-supabase-в-docker)
4. [Приложение, HTTPS и cron](#4-приложение-https-и-cron)
5. [Первый запуск: миграции, суперадмин, проверка](#5-первый-запуск-миграции-суперадмин-проверка)
6. [Переезд с Supabase Cloud](#6-переезд-с-supabase-cloud)
7. [Резервные копии](#7-резервные-копии)
8. [Обновления](#8-обновления)
9. [Мониторинг](#9-мониторинг)
10. [Если что-то не работает](#10-если-что-то-не-работает)

---

## 1. Как это устроено

```
 Интернет ──443──► Caddy (HTTPS, сертификаты Let's Encrypt автоматически)
                    ├── app.example.kz ──► app   (Next.js, образ из Dockerfile, порт 3000)
                    └── api.example.kz ──► kong:8000 (шлюз Supabase: Auth, REST, Realtime, Storage, Studio)
                    cron (alpine + busybox crond) ──► http://app:3000/api/cron/* с CRON_SECRET
 Supabase (официальный docker-compose): Postgres, Auth, PostgREST, Realtime, Storage (файлы на диске), Studio …
```

Два docker-compose проекта на одном сервере:

| Папка | Что | Откуда |
|---|---|---|
| `/opt/supabase` | Supabase | официальный `supabase/docker` из GitHub |
| `/opt/happy-steps` | app + caddy + cron | этот репозиторий (`docker-compose.yml`, `docker/`) |

Наш compose подключается к сети Supabase `supabase_default`, поэтому Caddy видит шлюз Supabase по имени `kong`.

## 2. Сервер, домены, Docker

**Сервер:** VPS/выделенный сервер у хостинга в Казахстане, Ubuntu 24.04, минимум **4 vCPU, 8 ГБ RAM, 80 ГБ SSD**
(сборка образа приложения требует ~3 ГБ памяти; на 4 ГБ RAM добавьте swap). Доступ по SSH под пользователем с `sudo`.

**Домены** (в DNS вашего домена, записи типа A на IP сервера):

| Запись | Для чего |
|---|---|
| `app.example.kz` | приложение (его увидят пользователи) |
| `api.example.kz` | API Supabase (браузеры обращаются к нему напрямую) |

**Docker и Node.js:**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker      # чтобы запускать docker без sudo
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs git
```

Node.js нужен только для служебных команд (миграции, суперадмин, перенос файлов) — приложение работает в Docker.

**Файрвол.** Снаружи должны быть открыты только 22, 80, 443:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

Важно: Docker публикует порты в обход `ufw`. Поэтому порты Postgres и шлюза Supabase мы привяжем к `127.0.0.1`
(шаг 3) — тогда снаружи их не видно. Если у хостинга есть «облачный файрвол», откройте в нём тоже только 22/80/443.

## 3. Supabase в Docker

Официальный стек большой (около 12 контейнеров), поэтому мы не копируем его, а берём у Supabase и меняем несколько настроек.

```bash
cd /opt && sudo mkdir -p supabase && sudo chown $USER supabase
git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase-src
cp -rf /tmp/supabase-src/docker/. /opt/supabase/ && rm -rf /tmp/supabase-src
cd /opt/supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env      # сгенерирует JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY и другие секреты в .env
```

Откройте `/opt/supabase/.env` (`nano .env`) и задайте:

| Переменная | Значение | Зачем |
|---|---|---|
| `POSTGRES_PASSWORD` | длинный случайный (`openssl rand -hex 24`) | пароль базы (проверьте, что `generate-keys.sh` его сменил) |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | свой логин и **сильный** пароль | вход в Studio по `https://api.example.kz` |
| `SUPABASE_PUBLIC_URL` | `https://api.example.kz` | внешний адрес API |
| `API_EXTERNAL_URL` | `https://api.example.kz/auth/v1` | внешний адрес Auth |
| `SITE_URL` | `https://app.example.kz` | адрес приложения |
| `ADDITIONAL_REDIRECT_URLS` | `https://app.example.kz/**` | |
| `DISABLE_SIGNUP` | `true` | самостоятельная регистрация запрещена — аккаунты создаёт администрация |
| `ENABLE_EMAIL_SIGNUP` | `true` | email-провайдер нужен для входа по телефону (технический e-mail, D-004) |
| `ENABLE_EMAIL_AUTOCONFIRM` | `true` | писем подтверждения нет |
| `ENABLE_PHONE_SIGNUP` | `false` | SMS не используются |
| `ENABLE_ANONYMOUS_USERS` | `false` | |
| `POOLER_TENANT_ID` | например `happysteps` | часть логина Postgres через пулер: `postgres.happysteps` |
| `COMPOSE_FILE` | `docker-compose.yml:docker-compose.localports.yml` | порты только на 127.0.0.1 (ниже) |

SMTP-настройки не нужны (писем приложение не отправляет).

Скопируйте из этого репозитория дополнение, которое закрывает порты Postgres (5432, 6543) и шлюза (8000) от интернета:

```bash
# репозиторий приложения клонируется в шаге 4; если его ещё нет — сначала выполните git clone из шага 4
cp /opt/happy-steps/docker/supabase/docker-compose.localports.yml /opt/supabase/
```

Запуск:

```bash
cd /opt/supabase
docker compose pull
docker compose up -d
docker compose ps         # все сервисы должны стать healthy (1–2 минуты)
```

Ключи для приложения — в `/opt/supabase/.env`: `ANON_KEY` и `SERVICE_ROLE_KEY`.

## 4. Приложение, HTTPS и cron

```bash
cd /opt && sudo mkdir -p happy-steps && sudo chown $USER happy-steps
git clone <адрес репозитория> /opt/happy-steps
cd /opt/happy-steps
cp .env.example .env
nano .env
```

Заполните `/opt/happy-steps/.env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://api.example.kz
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY из /opt/supabase/.env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY из /opt/supabase/.env>
APP_URL=https://app.example.kz
AUTH_EMAIL_DOMAIN=users.happysteps.kz          # при переезде — ТОЧНО то же значение, что было в Vercel
CRON_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<…>                # при переезде — те же ключи VAPID, что в Vercel
VAPID_PRIVATE_KEY=<…>
VAPID_SUBJECT=mailto:support@example.kz
TRUSTED_PROXY_HOPS=1
APP_DOMAIN=app.example.kz
API_DOMAIN=api.example.kz
ACME_EMAIL=admin@example.kz
# SUPABASE_DB_URL не нужен
```

Новые ключи VAPID (только для новой установки): `npx web-push generate-vapid-keys` (после `npm ci` в папке проекта).

Запуск (первая сборка 3–6 минут):

```bash
cd /opt/happy-steps
docker compose up -d --build
docker compose ps        # app — healthy, caddy и cron — running
```

Что поднимается (`docker-compose.yml`):

- **app** — образ из `Dockerfile` (Next.js standalone). `NEXT_PUBLIC_*` вшиваются при сборке — после их изменения
  нужен `docker compose up -d --build`. Healthcheck — `/api/health`.
- **caddy** — HTTPS для `APP_DOMAIN` и `API_DOMAIN`, сертификаты получает и продлевает сам (нужны открытые 80/443
  и DNS, указывающий на сервер). Конфиг — `docker/caddy/Caddyfile`. Caddy перезаписывает `X-Forwarded-For`
  реальным адресом клиента, поэтому `TRUSTED_PROXY_HOPS=1` (IP для лимитов входа и анкеты нельзя подделать).
  Если перед Caddy поставить ещё прокси (например, Cloudflare), в Caddy нужно указать его адреса как
  `trusted_proxies` и выставить `TRUSTED_PROXY_HOPS=2`.
- **cron** — `alpine` + встроенный busybox `crond`, без установки пакетов. Расписание — `docker/cron/crontab`
  (то же, что в `supabase/cron/schedule.sql`, время UTC), вызов — `docker/cron/call.sh`. Каждая попытка пишет строку в лог:
  `docker compose logs -f cron` → `… ok /api/cron/push-deferred {"ok":true,…}` или `FAIL … 401`.

Проверить cron вручную, не дожидаясь расписания:

```bash
docker compose run --rm cron --once /api/cron/push-deferred      # → ok … {"ok":true,…}
```

Supabase не на этом сервере? Удалите блок `{$API_DOMAIN}` из `docker/caddy/Caddyfile` и один раз создайте сеть:
`docker network create supabase_default`.

## 5. Первый запуск: миграции, суперадмин, проверка

**Миграции** (новая установка; при переезде с Cloud — пропустите, схема придёт с данными, см. раздел 6):

```bash
cd /opt/happy-steps
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/supabase/.env | cut -d= -f2-)
TENANT=$(grep '^POOLER_TENANT_ID=' /opt/supabase/.env | cut -d= -f2-)
npx supabase@latest db push --db-url "postgresql://postgres.${TENANT}:${PGPASS}@127.0.0.1:5432/postgres"
```

Если в пароле есть спецсимволы (`@`, `:`, `/`), используйте пароль только из букв и цифр.
Бакеты Storage создаются миграциями.

**Первый суперадмин** (скрипт сам прочитает `.env` в папке проекта):

```bash
cd /opt/happy-steps && npm ci
npm run superadmin:create -- --phone "+7 701 000 00 00" --name "Имя Фамилия"   # пароль спросит
```

**Проверка:**

```bash
curl https://app.example.kz/api/health          # {"ok":true}
curl -o /dev/null -w "%{http_code}\n" https://app.example.kz/login             # 200
curl -o /dev/null -w "%{http_code}\n" https://app.example.kz/api/cron/push-deferred   # 401 — без секрета нельзя
```

Затем войдите суперадмином → «Сады платформы» → «Создать сад» и отправьте ссылку владельцу.
Проверьте на телефоне: вход, загрузку фото/чека, чат (realtime), включение push-уведомлений.

## 6. Переезд с Supabase Cloud

Цель — перенести без потерь: базу (схемы `public`, `auth` — логины и пароли, `storage` — сведения о файлах,
история миграций), сами файлы и настройки. Пользователи входят со старыми паролями; им нужно будет войти заново
(у нового сервера свои ключи подписи сессий).

### 6.1 Подготовка (за 1–2 дня)

1. Поднимите сервер по разделам 2–4, **но не запускайте миграции** (раздел 5) — схема придёт из Cloud.
   В `/opt/happy-steps/.env` сразу укажите **те же** `AUTH_EMAIL_DOMAIN` и ключи VAPID, что в Vercel:
   другой домен логинов сломает вход, другие ключи VAPID отключат push у всех.
2. Если приложение сейчас открывается по `*.vercel.app`, заранее подключите к Vercel свой домен
   (`app.example.kz`) и переведите пользователей на него: установленное PWA и push-подписки привязаны к адресу сайта,
   при смене адреса их придётся настроить заново.
3. За час до переезда уменьшите TTL DNS-записи `app.example.kz` до 300 секунд.
4. Возьмите строку подключения к базе Cloud: Supabase Dashboard → **Connect** → **Session pooler**
   (`postgresql://postgres.<ref>:<пароль>@aws-0-<регион>.pooler.supabase.com:5432/postgres`).
5. Сделайте пробный прогон шагов 6.2–6.3 на этом же сервере и проверьте результат. Перед настоящим переездом верните
   Supabase в чистое состояние: `cd /opt/supabase && docker compose down -v && rm -rf volumes/db/data volumes/storage/* && docker compose up -d`.

### 6.2 Окно переезда (обычно 15–30 минут, лучше ночью)

1. **Остановите запись в Cloud.** Предупредите сады. Отключите cron в Cloud (SQL Editor:
   `select cron.unschedule(jobname) from cron.job where jobname like 'hs-%';`, если использовали `schedule.sql`).
   Чтобы никто ничего не изменил во время копирования, в Vercel можно временно включить защиту
   (Settings → Deployment Protection) или просто проводить переезд ночью.
2. **База.** Дамп Cloud делается программой `pg_dump` из контейнера Supabase на сервере, восстановление —
   нашим скриптом:

   ```bash
   cd /opt/happy-steps
   sudo DB_URL='postgresql://postgres.<ref>:<пароль>@aws-0-<регион>.pooler.supabase.com:5432/postgres' \
        BACKUP_DIR=/var/backups/happy-steps/from-cloud  docker/backup/backup.sh
   sudo docker/backup/restore.sh /var/backups/happy-steps/from-cloud/<папка с датой>
   cd /opt/supabase && docker compose restart
   ```

   `restore.sh` работает только с пустой базой, восстанавливает таблицы, функции, политики RLS, права (включая
   ограничения по колонкам), данные `auth`/`storage`, историю миграций и подписки realtime (чаты, уведомления).
   > Почему не официальная инструкция Supabase (psql + `supabase db dump`)? При ней новые таблицы получают
   > права Supabase «по умолчанию», и ограничения наших миграций (например, запрет менять отдельные колонки)
   > теряются. `restore.sh` на время восстановления выключает эти права по умолчанию — права совпадают с Cloud.
3. **Файлы Storage** (фото, документы, чеки). На сервере, в папке проекта:

   ```bash
   cd /opt/happy-steps && npm ci   # если ещё не делали
   SOURCE_SUPABASE_URL=https://<ref>.supabase.co   SOURCE_SERVICE_ROLE_KEY=<service_role Cloud> \
   TARGET_SUPABASE_URL=https://api.example.kz      TARGET_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY из /opt/supabase/.env> \
   npm run storage:copy
   ```

   Скрипт обходит все бакеты и загружает каждый файл заново (повторный запуск безопасен). Посмотреть список без
   копирования: `npm run storage:copy -- --dry-run`; один бакет: `--bucket receipts`. В конце — число ошибок (должно быть 0).
4. **Переключение DNS:** запись A для `app.example.kz` → IP сервера. Caddy получит сертификат при первом запросе.
   `api.example.kz` уже указывает на сервер.
5. **Проверка** (раздел 5, «Проверка») + войдите под несколькими ролями, откройте фото ребёнка и чек, отправьте
   сообщение в чат. Убедитесь, что `docker compose logs cron` показывает `ok`.
6. **Vercel:** после успешной проверки удалите домен из проекта Vercel и отключите в нём cron (или удалите проект).

### 6.3 Откат

Проект Supabase Cloud и Vercel **не удаляйте минимум 2 недели**. Если после переключения что-то пошло не так:

1. Верните DNS `app.example.kz` на Vercel (запись, которая была до переезда).
2. Если успели отключить cron в Cloud — снова выполните `supabase/cron/schedule.sql` (или верните `crons` в Vercel Pro).
3. Данные, созданные на новом сервере после переключения, в Cloud не попадут — поэтому решение об откате принимайте
   в первые часы; при необходимости перенесите их вручную.

## 7. Резервные копии

`docker/backup/backup.sh` делает каждую ночь:

- `db.dump` — база (схемы `public`, `auth`, `storage`, история миграций), формат `pg_dump -Fc`;
- `realtime.sql` — какие таблицы участвуют в realtime;
- `storage.tar.gz` — все файлы Storage (`/opt/supabase/volumes/storage`);
- хранит 14 дней (`KEEP_DAYS`), папка `/var/backups/happy-steps/<дата>`.

Включение (cron на самом сервере):

```bash
sudo tee /etc/cron.d/happy-steps-backup >/dev/null <<'EOF'
30 2 * * * root /opt/happy-steps/docker/backup/backup.sh >> /var/log/happy-steps-backup.log 2>&1
EOF
sudo /opt/happy-steps/docker/backup/backup.sh     # первая копия сразу — проверить, что работает
```

**Копия вне сервера обязательна** (если сервер сгорит, локальные копии пропадут вместе с ним). Например, на второй
сервер в РК раз в сутки: `rsync -a /var/backups/happy-steps/ backup@<второй-сервер>:/backups/happy-steps/`
(добавьте строку в тот же `/etc/cron.d/happy-steps-backup` на 03:30).

**Восстановление** — в чистый Supabase (как при переезде):

```bash
cd /opt/supabase && docker compose down -v && rm -rf volumes/db/data volumes/storage/* && docker compose up -d
# дождаться healthy (docker compose ps), затем:
sudo /opt/happy-steps/docker/backup/restore.sh /var/backups/happy-steps/<дата>
cd /opt/supabase && docker compose restart
```

Раз в месяц проверяйте восстановление на отдельной тестовой машине — непроверенная копия может оказаться пустой.

## 8. Обновления

**Приложение** (новая версия в репозитории):

```bash
cd /opt/happy-steps
sudo docker/backup/backup.sh                    # сначала копия
git pull
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/supabase/.env | cut -d= -f2-)
TENANT=$(grep '^POOLER_TENANT_ID=' /opt/supabase/.env | cut -d= -f2-)
npx supabase@latest db push --db-url "postgresql://postgres.${TENANT}:${PGPASS}@127.0.0.1:5432/postgres"
docker tag happy-steps:latest happy-steps:previous   # на случай отката
docker compose up -d --build
```

Откат приложения: `APP_IMAGE_TAG=previous docker compose up -d` (без `--build` — запустится сохранённый образ;
код в папке можно вернуть `git checkout <предыдущий коммит>`).
Миграции базы назад не откатываются — при проблеме с миграцией восстановите копию (раздел 7).

**Supabase** — по официальной инструкции (после резервной копии):
`cd /opt/supabase && sh update.sh --dry-run && sh update.sh && docker compose pull && docker compose up -d`.

**Сервер:** `sudo apt update && sudo apt upgrade` раз в месяц; Caddy обновляет сертификаты сам.
Очистка старых образов: `docker image prune -f`.

## 9. Мониторинг

- **Живость:** `https://app.example.kz/api/health` → `{"ok":true}`. Подключите внешний мониторинг (например,
  UptimeRobot или свой Uptime Kuma) с проверкой раз в 1–5 минут и уведомлением в Telegram/почту.
  `/api/health` проверяет только приложение; дополнительно мониторьте `https://app.example.kz/login` (200 — значит,
  приложение достучалось до базы и отрисовало страницу).
- **Контейнеры:** `docker compose ps` в `/opt/happy-steps` и `/opt/supabase` — всё `healthy`/`running`.
- **Логи:** `docker compose logs --tail=100 app`, `… caddy`, `… cron`; Supabase — `cd /opt/supabase && docker compose logs --tail=100 auth`.
- **Cron:** в `docker compose logs cron` каждые 5 минут строка `ok /api/cron/push-deferred`. `FAIL … 401` — не совпадает `CRON_SECRET`.
- **Копии:** `tail /var/log/happy-steps-backup.log` — каждую ночь `backup ok`.
- **Диск:** `df -h` — держите свободными не меньше 20 %.

## 10. Если что-то не работает

| Симптом | Что проверить |
|---|---|
| Caddy не получает сертификат | DNS указывает на сервер (`dig app.example.kz`), открыты 80 и 443, `docker compose logs caddy` |
| Страница входа открывается, но вход не проходит | `AUTH_EMAIL_DOMAIN` совпадает со значением, с которым создавались пользователи; `docker compose logs app` |
| Приложение не видит Supabase изнутри сервера | Некоторые хостинги не пускают сервер к собственному внешнему IP. Добавьте в сервис `app` в `docker-compose.yml`: `extra_hosts: ["api.example.kz:host-gateway"]` и пересоздайте: `docker compose up -d` |
| В браузере ошибки CORS/401 к `api.example.kz` | `NEXT_PUBLIC_SUPABASE_URL` и `ANON_KEY` в `.env` совпадают с `/opt/supabase/.env`; после изменения — `docker compose up -d --build` |
| Чаты не обновляются сами | Realtime: `cd /opt/supabase && docker compose logs realtime`; после восстановления из копии — применён ли `realtime.sql` |
| Push не приходят | Ключи VAPID те же, что при подписке; сайт открыт по HTTPS; в профиле уведомления включены |
| Сборка падает с `Killed` | Мало памяти — добавьте swap: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| `restore.sh`: «public schema is not empty» | Восстановление только в чистый Supabase — см. раздел 7 |

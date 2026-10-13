-- Happy Steps: расписание фоновых задач через pg_cron + pg_net + Vault — ИСТОЧНИК ИСТИНЫ для расписания
-- (DECISIONS.md D-036). docker/cron/crontab (свой сервер) повторяет его; совпадение проверяет
-- tests/unit/deploy-config.test.ts.
--
-- ЭТО НЕ МИГРАЦИЯ. Файл лежит вне supabase/migrations и не применяется `supabase db push`.
-- Запустите его в Supabase Dashboard → SQL Editor (или `psql "$SUPABASE_DB_URL" -f ...`),
-- предварительно заменив две строки-заглушки ниже.
--
-- ФАЙЛ МОЖНО ЗАПУСКАТЬ ПОВТОРНО (например, после смены адреса приложения или CRON_SECRET, или когда в
-- репозитории изменилось расписание): расширения и схема создаются через `if not exists`, секреты в Vault
-- обновляются, функция пересоздаётся (`create or replace`), а задания с теми же именами перезаписываются
-- (cron.schedule с существующим именем обновляет задание, дублей не будет).
--
-- Это планировщик по умолчанию для Vercel (на тарифе Hobby разрешены только ежедневные cron-задачи Vercel,
-- а нашим задачам нужен запуск каждые 5–15 минут, D-021). На Vercel Pro можно вместо этого файла добавить
-- блок `crons` в vercel.json — но НИКОГДА не оба сразу (задачи идемпотентны, но выполнялись бы дважды).
-- Перешли на vercel.json — отключите задания этого файла (см. «Отключить всё» ниже).
--
-- Где хранится секрет: в Supabase Vault (шифруется на диске, читается только ролью postgres).
-- В тексте заданий cron секрета нет — он подставляется в момент вызова из vault.decrypted_secrets.
--
-- Проверка после запуска:
--   select jobname, schedule, active from cron.job where jobname like 'hs-%';
--   select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, left(content, 120) as body, error_msg, created
--     from net._http_response order by created desc limit 20;   -- 200 = ок, 401 = неверный CRON_SECRET
-- Отключить всё:
--   select cron.unschedule(jobname) from cron.job where jobname like 'hs-%';

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- 1) Секреты. ЗАМЕНИТЕ значения (без слеша в конце адреса; секрет — тот же, что CRON_SECRET в Vercel).
do $$
declare
  v_app_url     text := 'https://app.example.kz';          -- ← адрес приложения (APP_URL)
  v_cron_secret text := 'REPLACE_WITH_CRON_SECRET';        -- ← значение CRON_SECRET
  v_id uuid;
begin
  if v_cron_secret = 'REPLACE_WITH_CRON_SECRET' or v_app_url like '%example.kz%' then
    raise exception 'Замените v_app_url и v_cron_secret в начале файла';
  end if;

  select id into v_id from vault.secrets where name = 'hs_app_url';
  if v_id is null then perform vault.create_secret(v_app_url, 'hs_app_url', 'Happy Steps: APP_URL for cron');
  else perform vault.update_secret(v_id, v_app_url); end if;

  v_id := null;
  select id into v_id from vault.secrets where name = 'hs_cron_secret';
  if v_id is null then perform vault.create_secret(v_cron_secret, 'hs_cron_secret', 'Happy Steps: CRON_SECRET');
  else perform vault.update_secret(v_id, v_cron_secret); end if;
end $$;

-- 2) Вспомогательная функция в закрытой схеме (не видна через API: PostgREST публикует только public).
create schema if not exists hs_cron;
revoke all on schema hs_cron from public;

create or replace function hs_cron.call(p_path text) returns bigint
language sql
set search_path = ''
as $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hs_app_url') || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hs_cron_secret')
    ),
    timeout_milliseconds := 120000
  );
$$;
revoke all on function hs_cron.call(text) from public;

-- 3) Расписание (время UTC). Новый маршрут /api/cron/* — добавьте строку здесь и в docker/cron/crontab.
select cron.schedule('hs-attendance-reminders', '*/15 * * * *', $$select hs_cron.call('/api/cron/attendance-reminders')$$);
select cron.schedule('hs-event-reminders',      '5 * * * *',    $$select hs_cron.call('/api/cron/event-reminders')$$);
select cron.schedule('hs-worktime-autoclose',   '*/15 * * * *', $$select hs_cron.call('/api/cron/worktime-autoclose')$$);
select cron.schedule('hs-document-expiry',      '0 3 * * *',    $$select hs_cron.call('/api/cron/document-expiry')$$);
select cron.schedule('hs-invoices-accrue',      '0 1 * * *',    $$select hs_cron.call('/api/cron/invoices-accrue')$$);
select cron.schedule('hs-push-deferred',        '*/5 * * * *',  $$select hs_cron.call('/api/cron/push-deferred')$$);

-- 4) Чистка журналов (иначе cron.job_run_details растёт бесконечно; ответы pg_net хранятся ~6 ч сами).
select cron.schedule('hs-cron-log-cleanup', '30 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

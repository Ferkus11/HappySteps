-- Local-only Realtime support (see realtime.mjs): every table in the `supabase_realtime`
-- publication gets a row trigger that NOTIFYs its primary key. Real Supabase reads the WAL instead.
create schema if not exists realtime_local;

create or replace function realtime_local.emit() returns trigger language plpgsql as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  pk jsonb;
  msg jsonb;
begin
  select coalesce(jsonb_object_agg(a.attname, r -> a.attname), '{}'::jsonb) into pk
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = tg_relid and i.indisprimary;
  msg := jsonb_build_object(
    'schema', tg_table_schema, 'table', tg_table_name, 'type', tg_op,
    'pk', pk, 'commit_timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  -- The row as of this change (NOTIFY payloads are limited to 8000 bytes; large rows are re-read).
  if tg_op <> 'DELETE' and octet_length(r::text) < 7000 then
    msg := msg || jsonb_build_object('record', r);
  end if;
  perform pg_notify('hs_realtime', msg::text);
  return null;
end $$;

create or replace function realtime_local.sync() returns void language plpgsql as $$
declare t record;
begin
  for t in select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' loop
    if not exists (
      select 1 from pg_trigger where tgname = 'zz_realtime_local' and tgrelid = format('%I.%I', t.schemaname, t.tablename)::regclass
    ) then
      execute format('create trigger zz_realtime_local after insert or update or delete on %I.%I for each row execute function realtime_local.emit()', t.schemaname, t.tablename);
    end if;
  end loop;
end $$;

select realtime_local.sync();

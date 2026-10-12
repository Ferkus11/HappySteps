-- Stage 2A · Staff work-time tracking and monthly timesheet (SPEC §5.2).
--
-- Model:
--   staff_schedules     weekly template: one row per working weekday (no row = day off)
--   schedule_overrides  a specific date: another shift (substitution / short day) or a day off
--   staff_absences      sick / vacation / day_off (отгул) / unexcused, for a period
--   work_sessions       start–finish intervals; several per day are summed
--
-- Writes to work_sessions happen ONLY through security definer functions that take the time from
-- the server (`now()`) or, for owner/head corrections, require a comment and mark the row as edited.
-- The single source of truth for day statuses is worktime_range() (dashboard, /worktime, timesheet).

-- ───────────── Tables ─────────────
create table public.staff_schedules (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  start_time time not null,
  end_time time not null,
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (kindergarten_id, user_id, weekday)
);

create table public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('shift', 'day_off')),
  start_time time,
  end_time time,
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'day_off' and start_time is null and end_time is null)
      or (kind = 'shift' and start_time is not null and end_time is not null and end_time > start_time)),
  unique (kindergarten_id, user_id, date)
);

create table public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('sick', 'vacation', 'day_off', 'unexcused')),
  date_from date not null,
  date_to date not null,
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (date_to >= date_from and date_to - date_from <= 366)
);
create index staff_absences_kg_idx on public.staff_absences (kindergarten_id, user_id, date_from);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null, -- local date (kindergarten time zone) of started_at
  started_at timestamptz not null,
  ended_at timestamptz,
  auto_closed boolean not null default false,
  edited boolean not null default false,
  edit_comment text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index work_sessions_kg_date_idx on public.work_sessions (kindergarten_id, work_date);
create index work_sessions_user_idx on public.work_sessions (user_id, work_date);
-- At most one open interval per person and kindergarten.
create unique index work_sessions_one_open on public.work_sessions (kindergarten_id, user_id) where ended_at is null;

-- ───────────── Helpers ─────────────
-- Is the user a staff member (any non-parent role, active or archived) of the kindergarten?
create or replace function public.worktime_is_staff_member(kg uuid, u uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  -- answers only for the caller's own gardens (or server-side calls without a user)
  select (auth.uid() is null or public.is_member(kg))
     and exists (select 1 from memberships m where m.kindergarten_id = kg and m.user_id = u and m.role <> 'parent')
$$;
revoke execute on function public.worktime_is_staff_member(uuid, uuid) from public, anon;
grant execute on function public.worktime_is_staff_member(uuid, uuid) to authenticated, service_role;

-- Can the current user see everybody's work time (owner/head/accountant)?
create or replace function public.worktime_sees_all(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner','head','accountant']::public.app_role[])
$$;
revoke execute on function public.worktime_sees_all(uuid) from public, anon;
grant execute on function public.worktime_sees_all(uuid) to authenticated, service_role;

create or replace function public.worktime_tz(kg uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from kindergarten_settings
                   where kindergarten_id = kg and (auth.uid() is null or public.is_member(kg))), 'Asia/Almaty')
$$;
revoke execute on function public.worktime_tz(uuid) from public, anon;
grant execute on function public.worktime_tz(uuid) to authenticated, service_role;

-- Same-kindergarten guard: the person must be staff of the row's kindergarten.
create or replace function public.tg_worktime_same_kg() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not public.worktime_is_staff_member(new.kindergarten_id, new.user_id) then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_schedules_same_kg before insert or update on public.staff_schedules
  for each row execute function public.tg_worktime_same_kg();
create trigger schedule_overrides_same_kg before insert or update on public.schedule_overrides
  for each row execute function public.tg_worktime_same_kg();
create trigger staff_absences_same_kg before insert or update on public.staff_absences
  for each row execute function public.tg_worktime_same_kg();
create trigger work_sessions_same_kg before insert or update on public.work_sessions
  for each row execute function public.tg_worktime_same_kg();

create trigger staff_schedules_touch before update on public.staff_schedules
  for each row execute function public.tg_touch_updated_at();

-- ───────────── RLS ─────────────
alter table public.staff_schedules enable row level security;
alter table public.schedule_overrides enable row level security;
alter table public.staff_absences enable row level security;
alter table public.work_sessions enable row level security;

-- Read: owner/head/accountant everything in their garden; staff only their own rows; parents nothing.
create policy staff_schedules_select on public.staff_schedules for select to authenticated
  using (public.worktime_sees_all(kindergarten_id) or (user_id = auth.uid() and public.is_staff(kindergarten_id)));
create policy schedule_overrides_select on public.schedule_overrides for select to authenticated
  using (public.worktime_sees_all(kindergarten_id) or (user_id = auth.uid() and public.is_staff(kindergarten_id)));
create policy staff_absences_select on public.staff_absences for select to authenticated
  using (public.worktime_sees_all(kindergarten_id) or (user_id = auth.uid() and public.is_staff(kindergarten_id)));
create policy work_sessions_select on public.work_sessions for select to authenticated
  using (public.worktime_sees_all(kindergarten_id) or (user_id = auth.uid() and public.is_staff(kindergarten_id)));

-- Write (schedules, overrides, absences): owner/head only.
create policy staff_schedules_insert on public.staff_schedules for insert to authenticated with check (public.is_admin(kindergarten_id));
create policy staff_schedules_update on public.staff_schedules for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy staff_schedules_delete on public.staff_schedules for delete to authenticated using (public.is_admin(kindergarten_id));

create policy schedule_overrides_insert on public.schedule_overrides for insert to authenticated with check (public.is_admin(kindergarten_id));
create policy schedule_overrides_update on public.schedule_overrides for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy schedule_overrides_delete on public.schedule_overrides for delete to authenticated using (public.is_admin(kindergarten_id));

create policy staff_absences_insert on public.staff_absences for insert to authenticated with check (public.is_admin(kindergarten_id));
create policy staff_absences_update on public.staff_absences for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy staff_absences_delete on public.staff_absences for delete to authenticated using (public.is_admin(kindergarten_id));

-- work_sessions: no direct writes for anybody (times must come from the server or from an audited
-- correction with a comment) → only the functions below.
revoke insert, update, delete on public.work_sessions from authenticated, anon;

-- ───────────── Start / finish (time from the server) ─────────────
create or replace function public.worktime_start(kg uuid) returns public.work_sessions
  language plpgsql volatile security definer set search_path = public as $$
declare
  r public.work_sessions;
begin
  if auth.uid() is null or not public.is_staff(kg) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from work_sessions where kindergarten_id = kg and user_id = auth.uid() and ended_at is null) then
    raise exception 'hs:worktimeAlreadyStarted';
  end if;
  insert into work_sessions (kindergarten_id, user_id, work_date, started_at, created_by)
  values (kg, auth.uid(), public.kg_today(kg), now(), auth.uid())
  returning * into r;
  return r;
end $$;

create or replace function public.worktime_finish(kg uuid) returns public.work_sessions
  language plpgsql volatile security definer set search_path = public as $$
declare
  r public.work_sessions;
begin
  if auth.uid() is null or not public.is_staff(kg) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update work_sessions set ended_at = greatest(now(), started_at)
  where kindergarten_id = kg and user_id = auth.uid() and ended_at is null
  returning * into r;
  if r.id is null then
    raise exception 'hs:worktimeNotStarted';
  end if;
  return r;
end $$;

-- ───────────── Corrections by owner/head (comment required, audited) ─────────────
create or replace function public.worktime_check_interval(kg uuid, u uuid, p_skip uuid, p_start timestamptz, p_end timestamptz)
  returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_end is not null and p_end <= p_start then
    raise exception 'hs:worktimeTimeOrder';
  end if;
  if p_start > now() or (p_end is not null and p_end > now() + interval '1 minute') then
    raise exception 'hs:worktimeFuture';
  end if;
  if exists (
    select 1 from work_sessions w
    where w.kindergarten_id = kg and w.user_id = u and w.id is distinct from p_skip
      and tstzrange(w.started_at, coalesce(w.ended_at, 'infinity')) && tstzrange(p_start, coalesce(p_end, 'infinity'))
  ) then
    raise exception 'hs:worktimeOverlap';
  end if;
end $$;
revoke execute on function public.worktime_check_interval(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- p_date/p_start/p_end are local (kindergarten time zone). p_end null keeps the interval open.
create or replace function public.worktime_edit_session(p_id uuid, p_date date, p_start time, p_end time, p_comment text)
  returns public.work_sessions
  language plpgsql volatile security definer set search_path = public as $$
declare
  old public.work_sessions;
  r public.work_sessions;
  tz text;
  s timestamptz;
  e timestamptz;
begin
  select * into old from work_sessions where id = p_id;
  if old.id is null or not public.is_admin(old.kindergarten_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'hs:commentRequired';
  end if;
  tz := public.worktime_tz(old.kindergarten_id);
  s := (p_date + p_start) at time zone tz;
  e := case when p_end is null then null else (p_date + p_end) at time zone tz end;
  perform public.worktime_check_interval(old.kindergarten_id, old.user_id, old.id, s, e);
  update work_sessions set work_date = p_date, started_at = s, ended_at = e, edited = true,
    edit_comment = trim(p_comment), edited_by = auth.uid(), edited_at = now()
  where id = p_id returning * into r;
  perform public.log_action(old.kindergarten_id, 'worktime.edit', 'work_session', p_id::text, jsonb_build_object(
    'user_id', old.user_id, 'comment', trim(p_comment),
    'old_start', old.started_at, 'old_end', old.ended_at, 'new_start', s, 'new_end', e));
  return r;
end $$;

create or replace function public.worktime_add_session(kg uuid, p_user uuid, p_date date, p_start time, p_end time, p_comment text)
  returns public.work_sessions
  language plpgsql volatile security definer set search_path = public as $$
declare
  r public.work_sessions;
  tz text;
  s timestamptz;
  e timestamptz;
begin
  if not public.is_admin(kg) or not public.worktime_is_staff_member(kg, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'hs:commentRequired';
  end if;
  if p_end is null then
    raise exception 'hs:worktimeTimeOrder';
  end if;
  tz := public.worktime_tz(kg);
  s := (p_date + p_start) at time zone tz;
  e := (p_date + p_end) at time zone tz;
  perform public.worktime_check_interval(kg, p_user, null, s, e);
  insert into work_sessions (kindergarten_id, user_id, work_date, started_at, ended_at, edited, edit_comment, edited_by, edited_at, created_by)
  values (kg, p_user, p_date, s, e, true, trim(p_comment), auth.uid(), now(), auth.uid())
  returning * into r;
  perform public.log_action(kg, 'worktime.edit', 'work_session', r.id::text, jsonb_build_object(
    'user_id', p_user, 'comment', trim(p_comment), 'added', true, 'new_start', s, 'new_end', e));
  return r;
end $$;

-- ───────────── Day statuses (one row per staff member and day) ─────────────
-- status: work (on time, still in) · done (on time / outside schedule, finished) · late · absent ·
--         unmarked (expected, no mark) · upcoming (expected later today or in the future) · off (not expected)
-- outside_schedule: worked on a day without a shift (never late).
create or replace function public.worktime_range(kg uuid, p_from date, p_to date)
  returns table (
    user_id uuid,
    full_name text,
    archived boolean,
    work_date date,
    is_holiday boolean,
    shift_start time,
    shift_end time,
    shift_source text,
    absence_kind text,
    sessions jsonb,
    first_start timestamptz,
    worked_minutes int,
    has_open boolean,
    auto_closed boolean,
    edited boolean,
    late_minutes int,
    outside_schedule boolean,
    status text
  )
  language sql stable security definer set search_path = public as $$
  with cfg as (
    select public.worktime_tz(kg) as tz,
           coalesce((select late_threshold_minutes from kindergarten_settings where kindergarten_id = kg), 10) as thr,
           public.is_staff(kg) as staff,
           public.worktime_sees_all(kg) as sees_all
  ),
  nowl as (select (now() at time zone cfg.tz) as ts, (now() at time zone cfg.tz)::date as today from cfg),
  days as (
    select g::date as d from generate_series(p_from::timestamp, least(p_to, p_from + 92)::timestamp, interval '1 day') g
  ),
  people as (
    select m.user_id,
           bool_or(m.status = 'active') as active,
           max((m.archived_at at time zone cfg.tz)::date) as archived_on
    from memberships m, cfg
    where m.kindergarten_id = kg and m.role <> 'parent' and cfg.staff and (cfg.sees_all or m.user_id = auth.uid())
    group by m.user_id
  ),
  grid as (
    select p.user_id, p.active, p.archived_on, dd.d, not public.kg_is_working_day(kg, dd.d) as hol
    from people p cross join days dd
  ),
  base as (
    select g.*, pr.full_name,
           o.kind as o_kind, o.start_time as o_start, o.end_time as o_end,
           t.start_time as t_start, t.end_time as t_end,
           a.kind as a_kind,
           ws.sessions, ws.first_start, ws.mins, ws.open, ws.auto, ws.edit
    from grid g
    join profiles pr on pr.id = g.user_id
    left join schedule_overrides o on o.kindergarten_id = kg and o.user_id = g.user_id and o.date = g.d
    left join staff_schedules t on t.kindergarten_id = kg and t.user_id = g.user_id and t.weekday = extract(isodow from g.d)
    left join lateral (
      select sa.kind from staff_absences sa
      where sa.kindergarten_id = kg and sa.user_id = g.user_id and g.d between sa.date_from and sa.date_to
      order by sa.created_at desc limit 1
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'started_at', w.started_at, 'ended_at', w.ended_at,
               'auto_closed', w.auto_closed, 'edited', w.edited, 'comment', w.edit_comment) order by w.started_at) as sessions,
             min(w.started_at) as first_start,
             sum(extract(epoch from (coalesce(w.ended_at, greatest(now(), w.started_at)) - w.started_at))) / 60 as mins,
             bool_or(w.ended_at is null) as open,
             bool_or(w.auto_closed) as auto,
             bool_or(w.edited) as edit
      from work_sessions w
      where w.kindergarten_id = kg and w.user_id = g.user_id and w.work_date = g.d
      having count(*) > 0
    ) ws on true
    -- employed that day (archived people keep their past), or has marks that day
    where g.active or g.archived_on is null or g.d < g.archived_on or ws.first_start is not null
  ),
  shifts as (
    select b.*,
           case when b.o_kind = 'shift' then b.o_start when b.o_kind = 'day_off' or b.hol then null else b.t_start end as s_start,
           case when b.o_kind = 'shift' then b.o_end when b.o_kind = 'day_off' or b.hol then null else b.t_end end as s_end,
           case when b.o_kind is not null then 'override' when b.hol then 'holiday' when b.t_start is not null then 'template' else 'none' end as src
    from base b
  ),
  late as (
    select s.*,
           case when s.s_start is not null and s.first_start is not null
                then floor(extract(epoch from ((s.first_start at time zone cfg.tz) - (s.d + s.s_start))) / 60)::int end as late_min,
           cfg.thr, nowl.ts as now_local, nowl.today
    from shifts s, cfg, nowl
  )
  select l.user_id, l.full_name, not l.active, l.d, l.hol, l.s_start, l.s_end, l.src, l.a_kind,
         coalesce(l.sessions, '[]'::jsonb), l.first_start, coalesce(round(l.mins), 0)::int,
         coalesce(l.open, false), coalesce(l.auto, false), coalesce(l.edit, false),
         greatest(coalesce(l.late_min, 0), 0),
         l.first_start is not null and l.s_start is null,
         case
           when l.first_start is not null then
             case when l.late_min > l.thr then 'late' when l.open then 'work' else 'done' end
           when l.a_kind is not null and l.s_start is not null then 'absent'
           when l.s_start is null then 'off'
           when l.d < l.today or (l.d = l.today and l.now_local >= l.d + l.s_start + make_interval(mins => l.thr)) then 'unmarked'
           else 'upcoming'
         end
  from late l
  order by l.full_name, l.user_id, l.d
$$;
revoke execute on function public.worktime_range(uuid, date, date) from public, anon;
grant execute on function public.worktime_range(uuid, date, date) to authenticated, service_role;

-- ───────────── Auto-close (cron, service role only) ─────────────
-- Forgot to finish: at shift end + 2h the open interval is closed at shift end with auto_closed.
-- Without a shift that day (or started after the shift end) it is closed at its start (0 min) once the
-- local day is over + 2h — no unconfirmed hours are counted; the head sees the flag and corrects it.
create or replace function public.worktime_autoclose(p_now timestamptz default now())
  returns table (session_id uuid, kindergarten_id uuid, user_id uuid, work_date date, ended_at timestamptz)
  language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  w record;
  tz text;
  s_start time;
  s_end time;
  hol boolean;
  shift_end_ts timestamptz;
  close_at timestamptz;
  due timestamptz;
begin
  for w in select ws.* from work_sessions ws where ws.ended_at is null and ws.started_at < p_now for update skip locked loop
    tz := public.worktime_tz(w.kindergarten_id);
    hol := not public.kg_is_working_day(w.kindergarten_id, w.work_date);
    select case when o.kind = 'shift' then o.start_time when o.kind = 'day_off' or hol then null else t.start_time end,
           case when o.kind = 'shift' then o.end_time when o.kind = 'day_off' or hol then null else t.end_time end
      into s_start, s_end
    from (select 1) x
    left join schedule_overrides o on o.kindergarten_id = w.kindergarten_id and o.user_id = w.user_id and o.date = w.work_date
    left join staff_schedules t on t.kindergarten_id = w.kindergarten_id and t.user_id = w.user_id
      and t.weekday = extract(isodow from w.work_date);
    shift_end_ts := case when s_end is null then null else (w.work_date + s_end) at time zone tz end;
    if shift_end_ts is not null and w.started_at < shift_end_ts then
      close_at := shift_end_ts;
      due := shift_end_ts + interval '2 hours';
    else
      close_at := w.started_at;
      due := ((w.work_date + 1)::timestamp at time zone tz) + interval '2 hours';
    end if;
    if p_now >= due then
      update work_sessions ws set ended_at = close_at, auto_closed = true where ws.id = w.id;
      insert into audit_log (kindergarten_id, actor_id, action, entity, entity_id, details)
      values (w.kindergarten_id, null, 'worktime.auto_close', 'work_session', w.id::text,
              jsonb_build_object('user_id', w.user_id, 'work_date', w.work_date, 'ended_at', close_at));
      session_id := w.id; kindergarten_id := w.kindergarten_id; user_id := w.user_id;
      work_date := w.work_date; ended_at := close_at;
      return next;
    end if;
  end loop;
end $$;
revoke execute on function public.worktime_autoclose(timestamptz) from public, anon, authenticated;
grant execute on function public.worktime_autoclose(timestamptz) to service_role;

revoke execute on function public.worktime_start(uuid) from public, anon;
revoke execute on function public.worktime_finish(uuid) from public, anon;
revoke execute on function public.worktime_edit_session(uuid, date, time, time, text) from public, anon;
revoke execute on function public.worktime_add_session(uuid, uuid, date, time, time, text) from public, anon;
grant execute on function public.worktime_start(uuid) to authenticated;
grant execute on function public.worktime_finish(uuid) to authenticated;
grant execute on function public.worktime_edit_session(uuid, date, time, time, text) to authenticated;
grant execute on function public.worktime_add_session(uuid, uuid, date, time, time, text) to authenticated;

-- Replaces a weekly template atomically (caller's rights — RLS on staff_schedules applies).
-- p_days: [{ "weekday": 1, "start": "08:00", "end": "17:00" }, ...]; missing weekdays are days off.
create or replace function public.worktime_save_schedule(kg uuid, p_user uuid, p_days jsonb) returns void
  language plpgsql security invoker set search_path = public as $$
begin
  delete from staff_schedules where kindergarten_id = kg and user_id = p_user;
  insert into staff_schedules (kindergarten_id, user_id, weekday, start_time, end_time)
  select kg, p_user, (d ->> 'weekday')::smallint, (d ->> 'start')::time, (d ->> 'end')::time
  from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) d;
end $$;
revoke execute on function public.worktime_save_schedule(uuid, uuid, jsonb) from public, anon;
grant execute on function public.worktime_save_schedule(uuid, uuid, jsonb) to authenticated;

-- Stage 2B · Children's attendance, absence reports from parents, kitchen portions (SPEC §5.3).
--
-- child_attendance   one row per child per date, bound to the child's group ON THAT DATE.
-- absence_reports    "Ребёнок не придёт" from a parent (date or period + reason).
-- attendance_reminders  bookkeeping for the reminder cron (service role only).
--
-- "Effective" status of a child on a date: the attendance row if any, otherwise "absent" when an
-- active absence report covers the date, otherwise "not marked".

-- ───────────────────────────── Absence reports ─────────────────────────────
create table public.absence_reports (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  reason text not null check (reason in ('sick', 'vacation', 'family', 'other')),
  comment text check (comment is null or length(comment) <= 500),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  check (date_to >= date_from and date_to - date_from <= 92)
);
create index absence_reports_child_idx on public.absence_reports (child_id, date_from);
create index absence_reports_kg_idx on public.absence_reports (kindergarten_id, date_from, date_to) where cancelled_at is null;

-- ───────────────────────────── Attendance ─────────────────────────────
create table public.child_attendance (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- group on `date` (set by trigger)
  date date not null,
  status text not null check (status in ('present', 'absent')),
  reason text check (reason in ('sick', 'vacation', 'family', 'other')),
  absence_report_id uuid references public.absence_reports(id) on delete set null,
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (child_id, date),
  check (status = 'absent' or reason is null)
);
create index child_attendance_kg_date_idx on public.child_attendance (kindergarten_id, date);
create index child_attendance_group_date_idx on public.child_attendance (group_id, date);

-- ───────────────────────────── Reminder bookkeeping ─────────────────────────────
create table public.attendance_reminders (
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  date date not null,
  level text not null check (level in ('teacher', 'head')),
  sent_at timestamptz not null default now(),
  primary key (group_id, date, level)
);

-- ───────────────────────────── Helpers ─────────────────────────────

-- Active (not cancelled) absence report of a child covering a date.
create or replace function public.active_absence_report(p_child uuid, p_date date) returns public.absence_reports
  language sql stable security definer set search_path = public as $$
  select * from absence_reports
  where child_id = p_child and cancelled_at is null and p_date between date_from and date_to
  order by created_at desc limit 1
$$;
revoke execute on function public.active_absence_report(uuid, date) from public, anon, authenticated;

-- Children belonging to a group within [p_from, p_to] according to the group history
-- (SPEC §5.1: attendance history stays with the group of that date). in_from/in_to are clipped to the range.
-- Visible to owner/head/accountant and teachers of the group.
create or replace function public.attendance_roster(p_group uuid, p_from date, p_to date)
  returns table (child_id uuid, full_name text, photo_path text, allergies text, in_from date, in_to date)
  language sql stable security definer set search_path = public as $$
  select c.id, c.full_name, c.photo_path, c.allergies,
         greatest(h.from_date, c.enrolled_on, p_from) as in_from,
         least(coalesce(h.to_date, p_to), p_to) as in_to
  from child_group_history h
  join children c on c.id = h.child_id
  join groups g on g.id = h.group_id
  where h.group_id = p_group
    and h.from_date <= p_to and (h.to_date is null or h.to_date >= p_from)
    and c.enrolled_on <= p_to
    and greatest(h.from_date, c.enrolled_on, p_from) <= least(coalesce(h.to_date, p_to), p_to)
    and (c.status = 'active' or h.to_date is not null)
    and (public.has_role(g.kindergarten_id, array['owner','head','accountant']::public.app_role[]) or public.teaches_group(p_group))
  order by c.full_name
$$;
revoke execute on function public.attendance_roster(uuid, date, date) from public, anon;
grant execute on function public.attendance_roster(uuid, date, date) to authenticated, service_role;

-- Internal: per-group counts for a date (no permission check — callers check).
create or replace function public._attendance_counts(kg uuid, d date)
  returns table (group_id uuid, group_name text, color text, sort_order int,
                 active int, reported int, marked int, present int, absent int, expected int, unmarked int)
  language sql stable security definer set search_path = public as $$
  with roster as (
    select g.id as gid, h.child_id
    from groups g
    join child_group_history h on h.group_id = g.id and h.from_date <= d and (h.to_date is null or h.to_date >= d)
    join children c on c.id = h.child_id and c.status = 'active' and c.enrolled_on <= d
    where g.kindergarten_id = kg
  ), per_child as (
    select r.gid, r.child_id,
      a.status as row_status,
      exists (select 1 from absence_reports ar where ar.child_id = r.child_id and ar.cancelled_at is null
              and d between ar.date_from and ar.date_to) as reported
    from roster r
    left join child_attendance a on a.child_id = r.child_id and a.date = d
  )
  select g.id, g.name, g.color, g.sort_order,
    count(p.child_id)::int,
    count(*) filter (where p.reported)::int,
    count(p.row_status)::int,
    count(*) filter (where p.row_status = 'present')::int,
    count(*) filter (where p.row_status = 'absent' or (p.row_status is null and p.reported))::int,
    (count(p.child_id) - count(*) filter (where p.row_status = 'absent' or (p.row_status is null and p.reported)))::int,
    count(*) filter (where p.child_id is not null and p.row_status is null and not p.reported)::int
  from groups g
  left join per_child p on p.gid = g.id
  where g.kindergarten_id = kg
  group by g.id, g.name, g.color, g.sort_order
$$;
revoke execute on function public._attendance_counts(uuid, date) from public, anon, authenticated;

-- Number of portions per group for the kitchen (SPEC §5.3). Staff of the kindergarten only;
-- returns numbers, never child names. `present` is null while nobody in the group is marked.
-- expected = active − effectively absent (= present once everybody is marked,
-- = active − reported before marking). `unmarked` = children with neither a mark nor a report.
create or replace function public.expected_portions(kg uuid, d date)
  returns table (group_id uuid, group_name text, color text, active int, reported int,
                 marked int, present int, absent int, expected int, unmarked int)
  language plpgsql stable security definer set search_path = public as $$
begin
  -- club teachers have no access to attendance (SPEC §3.4)
  if not public.has_role(kg, array['owner','head','accountant','teacher','cook']::public.app_role[]) then
    raise exception 'hs:forbidden' using errcode = '42501';
  end if;
  return query
    select c.group_id, c.group_name, c.color, c.active, c.reported, c.marked,
           case when c.marked > 0 then c.present end, c.absent, c.expected, c.unmarked
    from public._attendance_counts(kg, d) c
    order by c.sort_order, c.group_name;
end $$;
revoke execute on function public.expected_portions(uuid, date) from public, anon;
grant execute on function public.expected_portions(uuid, date) to authenticated, service_role;

-- ───────────────────────────── Triggers ─────────────────────────────

-- Attendance row: tenant check, group of the date, reason from the parent's report, author, date rules, audit.
create or replace function public.tg_child_attendance() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  ch children;
  rep absence_reports;
  today date;
begin
  select * into ch from children where id = new.child_id;
  if ch.id is null or ch.kindergarten_id is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.child_id <> old.child_id or new.date <> old.date or new.kindergarten_id <> old.kindergarten_id) then
    raise exception 'hs:invalid' using errcode = '22023';
  end if;
  today := public.kg_today(new.kindergarten_id);
  if new.date > today then
    raise exception 'hs:attendanceFuture' using errcode = '22023';
  end if;
  new.group_id := public.child_group_on(new.child_id, new.date);
  if new.group_id is null then
    raise exception 'hs:invalid' using errcode = '22023';
  end if;
  if new.status = 'absent' then
    rep := public.active_absence_report(new.child_id, new.date);
    new.absence_report_id := rep.id; -- never trust a client-supplied link
    if rep.id is not null then
      new.reason := coalesce(new.reason, rep.reason);
    end if;
  else
    new.reason := null;
    new.absence_report_id := null;
  end if;
  if auth.uid() is not null then
    new.marked_by := auth.uid();
    new.marked_at := now();
  end if;
  return new;
end $$;
create trigger child_attendance_biu before insert or update on public.child_attendance
  for each row execute function public.tg_child_attendance();

-- SPEC §5.3: every change of a past day is audited (AFTER trigger: an upsert fires the BEFORE INSERT
-- trigger even when it ends up updating, so auditing there would double-count).
create or replace function public.tg_child_attendance_audit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'DELETE' then
    if old.date < public.kg_today(old.kindergarten_id) then
      insert into audit_log (kindergarten_id, actor_id, action, entity, entity_id, details)
      values (old.kindergarten_id, auth.uid(), 'attendance.edit_past', 'child', old.child_id::text,
        jsonb_build_object('date', old.date, 'status', null, 'previous', old.status));
    end if;
    return null;
  end if;
  if new.date < public.kg_today(new.kindergarten_id)
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason) then
    insert into audit_log (kindergarten_id, actor_id, action, entity, entity_id, details)
    values (new.kindergarten_id, auth.uid(), 'attendance.edit_past', 'child', new.child_id::text,
      jsonb_build_object('date', new.date, 'status', new.status, 'previous', case when tg_op = 'UPDATE' then old.status end));
  end if;
  return null;
end $$;
create trigger child_attendance_audit after insert or update or delete on public.child_attendance
  for each row execute function public.tg_child_attendance_audit();


create or replace function public.tg_absence_report() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if exists (
    select 1 from absence_reports ar
    where ar.child_id = new.child_id and ar.cancelled_at is null and ar.id <> new.id
      and ar.date_from <= new.date_to and ar.date_to >= new.date_from
  ) then
    raise exception 'hs:absenceOverlap' using errcode = '23505';
  end if;
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger absence_reports_bi before insert on public.absence_reports
  for each row execute function public.tg_absence_report();

-- Cancel a report (parent: before the day starts in the kindergarten's time zone; owner/head: any time).
-- A period that has already started is shortened to end today (the remaining days are cancelled).
create or replace function public.cancel_absence_report(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare r absence_reports; today date; admin boolean;
begin
  select * into r from absence_reports where id = p_id for update;
  if r.id is null or r.cancelled_at is not null then
    raise exception 'hs:notFound' using errcode = 'P0002';
  end if;
  admin := public.is_admin(r.kindergarten_id);
  if not admin and not public.is_guardian(r.child_id) then
    raise exception 'hs:forbidden' using errcode = '42501';
  end if;
  today := public.kg_today(r.kindergarten_id);
  if r.date_from > today or admin then
    update absence_reports set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
  elsif r.date_to > today then
    update absence_reports set date_to = today where id = p_id;
  else
    raise exception 'hs:absenceStarted' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.cancel_absence_report(uuid) from public, anon;
grant execute on function public.cancel_absence_report(uuid) to authenticated;

-- ───────────────────────────── Reminders (cron) ─────────────────────────────
-- Groups that are due a reminder now: working day in the kindergarten's time zone, past the
-- reminder (level 'teacher') / escalation (level 'head') time, group has children and some of them
-- have neither an attendance row nor an absence report, and the reminder was not sent yet.
create or replace function public.attendance_reminders_due(p_now timestamptz default now())
  returns table (kindergarten_id uuid, group_id uuid, group_name text, date date, level text)
  language sql stable security definer set search_path = public as $$
  with kgs as (
    select s.kindergarten_id as kg,
           (p_now at time zone s.timezone)::date as d,
           (p_now at time zone s.timezone)::time as t,
           s.attendance_reminder_time as rt,
           s.attendance_escalation_time as et
    from kindergarten_settings s
    where public.kg_is_open(s.kindergarten_id)
  ), open_kgs as (
    -- a missed cron run must not produce a "mark attendance" reminder late in the day
    select * from kgs where public.kg_is_working_day(kg, d) and t >= rt and t < rt + interval '4 hours'
  ), unmarked as (
    select k.kg, k.d, k.t, k.et, g.id as gid, g.name as gname
    from open_kgs k
    join groups g on g.kindergarten_id = k.kg
    where exists (
      select 1 from child_group_history h
      join children c on c.id = h.child_id and c.status = 'active' and c.enrolled_on <= k.d
      where h.group_id = g.id and h.from_date <= k.d and (h.to_date is null or h.to_date >= k.d)
        and not exists (select 1 from child_attendance a where a.child_id = c.id and a.date = k.d)
        and not exists (select 1 from absence_reports ar where ar.child_id = c.id and ar.cancelled_at is null
                        and k.d between ar.date_from and ar.date_to)
    )
  ), levels as (
    select u.*, 'teacher'::text as level from unmarked u
    union all
    select u.*, 'head'::text from unmarked u where u.t >= u.et
  )
  select l.kg, l.gid, l.gname, l.d, l.level
  from levels l
  where not exists (select 1 from attendance_reminders r where r.group_id = l.gid and r.date = l.d and r.level = l.level)
  order by 1, 3, 5
$$;
revoke execute on function public.attendance_reminders_due(timestamptz) from public, anon, authenticated;
grant execute on function public.attendance_reminders_due(timestamptz) to service_role;

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.child_attendance enable row level security;
alter table public.absence_reports enable row level security;
alter table public.attendance_reminders enable row level security;

-- Attendance: owner/head full; accountant view; teacher reads own groups, marks own groups TODAY only;
-- parent reads own children; club_teacher and cook nothing (cook gets numbers via expected_portions).
create policy child_attendance_select on public.child_attendance for select to authenticated using (
  public.has_role(kindergarten_id, array['owner','head','accountant']::public.app_role[])
  or public.teaches_group(group_id)
  or public.is_guardian(child_id)
);
create policy child_attendance_insert on public.child_attendance for insert to authenticated with check (
  public.is_admin(kindergarten_id)
  or (public.teaches_group(group_id) and date = public.kg_today(kindergarten_id))
);
create policy child_attendance_update on public.child_attendance for update to authenticated
  using (public.is_admin(kindergarten_id) or (public.teaches_group(group_id) and date = public.kg_today(kindergarten_id)))
  with check (public.is_admin(kindergarten_id) or (public.teaches_group(group_id) and date = public.kg_today(kindergarten_id)));
create policy child_attendance_delete on public.child_attendance for delete to authenticated
  using (public.is_admin(kindergarten_id) or (public.teaches_group(group_id) and date = public.kg_today(kindergarten_id)));
-- Upserts (PostgREST `on conflict do update`) touch the key columns too; the trigger rejects changing them.
revoke insert, update on public.child_attendance from authenticated;
grant insert (kindergarten_id, child_id, date, status, reason) on public.child_attendance to authenticated;
grant update (kindergarten_id, child_id, date, status, reason) on public.child_attendance to authenticated;

-- Absence reports: staff that see attendance read them; parents read and create for own children
-- (not for past days); owner/head may create on a parent's behalf. Cancel only via cancel_absence_report().
create policy absence_reports_select on public.absence_reports for select to authenticated using (
  public.has_role(kindergarten_id, array['owner','head','accountant']::public.app_role[])
  or public.teaches_child(child_id)
  or public.is_guardian(child_id)
);
create policy absence_reports_insert on public.absence_reports for insert to authenticated with check (
  (public.is_guardian(child_id) and date_from >= public.kg_today(kindergarten_id) and cancelled_at is null)
  or public.is_admin(kindergarten_id)
);
revoke update, delete on public.absence_reports from authenticated;

-- attendance_reminders: no policies → service role only.

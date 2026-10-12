-- Stage 2D · Announcements (SPEC §5.5) and events calendar incl. birthdays (SPEC §5.6).
--
-- Audience model shared by announcements and events:
--   'all'    → every active member of the kindergarten
--   'groups' → owner/head/accountant + teachers of the selected groups + parents of children currently in them
--   'staff'  → staff roles only (everyone except parents)
-- The author always sees own rows. Owner/head publish to any audience; a teacher only to own groups.

-- ───────────────────────────── Tables ─────────────────────────────
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  audience text not null check (audience in ('all', 'groups', 'staff')),
  title text not null check (length(trim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 10000),
  important boolean not null default false,
  reminded_at timestamptz, -- last "Напомнить" (rate limit: once per hour)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_kg_idx on public.announcements (kindergarten_id, important desc, created_at desc);

create table public.announcement_groups (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  primary key (announcement_id, group_id)
);
create index announcement_groups_group_idx on public.announcement_groups (group_id);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index announcement_reads_user_idx on public.announcement_reads (user_id);

create table public.announcement_files (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  kind text not null check (kind in ('photo', 'pdf')),
  path text not null unique,
  name text not null check (length(name) between 1 and 200),
  -- files live under <kindergarten>/<announcement>/ — a row can never point at someone else's object
  check (path like kindergarten_id::text || '/' || announcement_id::text || '/%'),
  mime text not null,
  size int not null check (size > 0 and size <= 15 * 1024 * 1024),
  created_at timestamptz not null default now()
);
create index announcement_files_ann_idx on public.announcement_files (announcement_id, created_at);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  audience text not null check (audience in ('all', 'groups', 'staff')),
  kind text not null default 'other' check (kind in ('matinee', 'parent_meeting', 'holiday', 'day_off', 'excursion', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  date date not null,
  start_time time,
  end_time time,
  place text check (place is null or length(place) <= 200),
  description text check (description is null or length(description) <= 5000),
  reminded_for date, -- the event date a reminder was sent for (re-sent if the date moves)
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time >= start_time),
  check (end_time is null or start_time is not null)
);
create index events_kg_date_idx on public.events (kindergarten_id, date);

create table public.event_groups (
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  primary key (event_id, group_id)
);
create index event_groups_group_idx on public.event_groups (group_id);

-- ───────────────────────────── Audience helpers ─────────────────────────────
-- Core rule: is user `uid` in the audience? Internal (takes an arbitrary uid) → not executable by clients.
create or replace function public.audience_member(kg uuid, aud text, gids uuid[], uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.kg_is_open(kg) and case aud
    when 'all' then exists (
      select 1 from memberships m where m.user_id = uid and m.kindergarten_id = kg and m.status = 'active')
    when 'staff' then exists (
      select 1 from memberships m where m.user_id = uid and m.kindergarten_id = kg and m.status = 'active' and m.role <> 'parent')
    when 'groups' then
      exists (
        select 1 from memberships m where m.user_id = uid and m.kindergarten_id = kg and m.status = 'active'
          and m.role in ('owner', 'head', 'accountant'))
      or exists (
        select 1 from group_teachers gt
        join memberships m on m.user_id = gt.user_id and m.kindergarten_id = gt.kindergarten_id and m.role = 'teacher' and m.status = 'active'
        where gt.user_id = uid and gt.kindergarten_id = kg and gt.group_id = any(gids))
      or exists (
        select 1 from child_guardians cg
        join children c on c.id = cg.child_id and c.status = 'active'
        join memberships m on m.user_id = cg.user_id and m.kindergarten_id = cg.kindergarten_id and m.role = 'parent' and m.status = 'active'
        where cg.user_id = uid and cg.kindergarten_id = kg and c.group_id = any(gids))
    else false
  end
$$;
revoke execute on function public.audience_member(uuid, text, uuid[], uuid) from public, anon, authenticated;

-- The same rule for the current user (safe for clients: only answers about themselves).
create or replace function public.in_audience(kg uuid, aud text, gids uuid[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.audience_member(kg, aud, gids, auth.uid())
$$;
revoke execute on function public.in_audience(uuid, text, uuid[]) from public, anon;
grant execute on function public.in_audience(uuid, text, uuid[]) to authenticated, service_role;

-- Who may publish with this audience: owner/head anything; a teacher only 'groups' (own groups checked per row).
create or replace function public.can_publish(kg uuid, aud text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_admin(kg) or (aud = 'groups' and public.has_role(kg, array['teacher']::public.app_role[]))
$$;
revoke execute on function public.can_publish(uuid, text) from public, anon;
grant execute on function public.can_publish(uuid, text) to authenticated, service_role;

create or replace function public.announcement_group_ids(a uuid) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(group_id), '{}') from announcement_groups where announcement_id = a
$$;
revoke execute on function public.announcement_group_ids(uuid) from public, anon;
grant execute on function public.announcement_group_ids(uuid) to authenticated, service_role;

create or replace function public.event_group_ids(e uuid) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(group_id), '{}') from event_groups where event_id = e
$$;
revoke execute on function public.event_group_ids(uuid) from public, anon;
grant execute on function public.event_group_ids(uuid) to authenticated, service_role;

-- Can the current user see this announcement? (used by the policies of the child tables)
create or replace function public.announcement_visible(a uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcements x
    where x.id = a and public.is_member(x.kindergarten_id)
      and (x.author_id = auth.uid() or public.audience_member(x.kindergarten_id, x.audience, public.announcement_group_ids(x.id), auth.uid()))
  )
$$;
revoke execute on function public.announcement_visible(uuid) from public, anon;
grant execute on function public.announcement_visible(uuid) to authenticated, service_role;

-- Author or owner/head: edit, delete, see read stats, remind.
create or replace function public.announcement_manageable(a uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcements x
    where x.id = a and (public.is_admin(x.kindergarten_id) or (x.author_id = auth.uid() and public.is_member(x.kindergarten_id)))
  )
$$;
revoke execute on function public.announcement_manageable(uuid) from public, anon;
grant execute on function public.announcement_manageable(uuid) to authenticated, service_role;

create or replace function public.event_visible(e uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from events x
    where x.id = e and public.is_member(x.kindergarten_id)
      and (x.author_id = auth.uid() or public.audience_member(x.kindergarten_id, x.audience, public.event_group_ids(x.id), auth.uid()))
  )
$$;
revoke execute on function public.event_visible(uuid) from public, anon;
grant execute on function public.event_visible(uuid) to authenticated, service_role;

create or replace function public.event_manageable(e uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from events x
    where x.id = e and (public.is_admin(x.kindergarten_id) or (x.author_id = auth.uid() and public.is_member(x.kindergarten_id)))
  )
$$;
revoke execute on function public.event_manageable(uuid) from public, anon;
grant execute on function public.event_manageable(uuid) to authenticated, service_role;

-- Group targeting: owner/head any group of the kindergarten; the teacher-author only own groups.
create or replace function public.can_target_group(kg uuid, author uuid, aud text, g uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select aud = 'groups'
    and (select kindergarten_id from groups where id = g) = kg
    and (public.is_admin(kg) or (author = auth.uid() and public.teaches_group(g)))
$$;
revoke execute on function public.can_target_group(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.can_target_group(uuid, uuid, text, uuid) to authenticated, service_role;

-- ───────────────────────────── Integrity triggers ─────────────────────────────
create or replace function public.tg_announcement_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.kindergarten_id <> old.kindergarten_id or new.author_id is distinct from old.author_id then
      raise exception 'kindergarten is immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger announcements_guard before update on public.announcements
  for each row execute function public.tg_announcement_guard();
create trigger events_guard before update on public.events
  for each row execute function public.tg_announcement_guard();

-- Link rows must belong to the same kindergarten as their parent rows.
create or replace function public.tg_same_kg_announcement_link() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from announcements where id = new.announcement_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_table_name = 'announcement_groups'
     and (select kindergarten_id from groups where id = (to_jsonb(new) ->> 'group_id')::uuid) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger announcement_groups_same_kg before insert or update on public.announcement_groups
  for each row execute function public.tg_same_kg_announcement_link();
create trigger announcement_reads_same_kg before insert or update on public.announcement_reads
  for each row execute function public.tg_same_kg_announcement_link();
create trigger announcement_files_same_kg before insert or update on public.announcement_files
  for each row execute function public.tg_same_kg_announcement_link();

create or replace function public.tg_same_kg_event_group() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from events where id = new.event_id) is distinct from new.kindergarten_id
     or (select kindergarten_id from groups where id = new.group_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger event_groups_same_kg before insert or update on public.event_groups
  for each row execute function public.tg_same_kg_event_group();

-- At most 10 photos and 10 PDFs per announcement (SPEC §5.5).
create or replace function public.tg_announcement_files_limit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from announcement_files where announcement_id = new.announcement_id and kind = new.kind) >= 10 then
    raise exception 'hs:tooManyFiles';
  end if;
  return new;
end $$;
create trigger announcement_files_limit before insert on public.announcement_files
  for each row execute function public.tg_announcement_files_limit();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.announcements enable row level security;
alter table public.announcement_groups enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.announcement_files enable row level security;
alter table public.events enable row level security;
alter table public.event_groups enable row level security;

-- announcements (column check instead of announcement_visible() so INSERT … RETURNING works for the author)
create policy announcements_select on public.announcements for select to authenticated using (
  public.is_member(kindergarten_id)
  and (author_id = auth.uid() or public.in_audience(kindergarten_id, audience, public.announcement_group_ids(id)))
);
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.can_publish(kindergarten_id, audience));
revoke insert on public.announcements from authenticated;
grant insert (kindergarten_id, author_id, audience, title, body, important) on public.announcements to authenticated;
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_admin(kindergarten_id) or (author_id = auth.uid() and public.is_member(kindergarten_id)))
  with check ((public.is_admin(kindergarten_id) or author_id = auth.uid()) and public.can_publish(kindergarten_id, audience));
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_admin(kindergarten_id) or (author_id = auth.uid() and public.is_member(kindergarten_id)));
revoke update on public.announcements from authenticated;
grant update (audience, title, body, important) on public.announcements to authenticated;

create policy announcement_groups_select on public.announcement_groups for select to authenticated
  using (public.announcement_visible(announcement_id));
create policy announcement_groups_insert on public.announcement_groups for insert to authenticated with check (
  public.announcement_manageable(announcement_id)
  and public.can_target_group(kindergarten_id, (select author_id from announcements where id = announcement_id),
                              (select audience from announcements where id = announcement_id), group_id)
);
create policy announcement_groups_delete on public.announcement_groups for delete to authenticated
  using (public.announcement_manageable(announcement_id));
revoke update on public.announcement_groups from authenticated;

-- reads: a user inserts only own read of a visible announcement; author/admin see all reads.
create policy announcement_reads_select on public.announcement_reads for select to authenticated
  using (user_id = auth.uid() or public.announcement_manageable(announcement_id));
create policy announcement_reads_insert on public.announcement_reads for insert to authenticated
  with check (user_id = auth.uid() and public.announcement_visible(announcement_id));
revoke update, delete on public.announcement_reads from authenticated;

create policy announcement_files_select on public.announcement_files for select to authenticated
  using (public.announcement_visible(announcement_id));
-- rows are inserted by the upload action with the service role, after its own permission check
revoke insert on public.announcement_files from authenticated;
create policy announcement_files_delete on public.announcement_files for delete to authenticated
  using (public.announcement_manageable(announcement_id));
revoke update on public.announcement_files from authenticated;

-- events
create policy events_select on public.events for select to authenticated using (
  public.is_member(kindergarten_id)
  and (author_id = auth.uid() or public.in_audience(kindergarten_id, audience, public.event_group_ids(id)))
);
-- "Выходной день сада" also creates a holiday row (D-022), so only owner/head may use that kind.
create policy events_insert on public.events for insert to authenticated
  with check (author_id = auth.uid() and public.can_publish(kindergarten_id, audience)
              and (kind <> 'day_off' or public.is_admin(kindergarten_id)));
revoke insert on public.events from authenticated;
grant insert (kindergarten_id, author_id, audience, kind, title, date, start_time, end_time, place, description) on public.events to authenticated;
create policy events_update on public.events for update to authenticated
  using (public.is_admin(kindergarten_id) or (author_id = auth.uid() and public.is_member(kindergarten_id)))
  with check ((public.is_admin(kindergarten_id) or author_id = auth.uid()) and public.can_publish(kindergarten_id, audience)
              and (kind <> 'day_off' or public.is_admin(kindergarten_id)));
create policy events_delete on public.events for delete to authenticated
  using (public.is_admin(kindergarten_id) or (author_id = auth.uid() and public.is_member(kindergarten_id)));
revoke update on public.events from authenticated;
grant update (audience, kind, title, date, start_time, end_time, place, description) on public.events to authenticated;

create policy event_groups_select on public.event_groups for select to authenticated
  using (public.event_visible(event_id));
create policy event_groups_insert on public.event_groups for insert to authenticated with check (
  public.event_manageable(event_id)
  and public.can_target_group(kindergarten_id, (select author_id from events where id = event_id),
                              (select audience from events where id = event_id), group_id)
);
create policy event_groups_delete on public.event_groups for delete to authenticated
  using (public.event_manageable(event_id));
revoke update on public.event_groups from authenticated;

-- ───────────────────────────── Functions for the app ─────────────────────────────
-- Recipients of an announcement (author excluded) with read status. Only for author/owner/head.
create or replace function public.announcement_audience(p_id uuid)
  returns table (user_id uuid, full_name text, read_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, r.read_at
  from announcements a
  join profiles p on p.id in (select m.user_id from memberships m where m.kindergarten_id = a.kindergarten_id and m.status = 'active')
  left join announcement_reads r on r.announcement_id = a.id and r.user_id = p.id
  where a.id = p_id
    and public.announcement_manageable(a.id)
    and p.id is distinct from a.author_id
    and public.audience_member(a.kindergarten_id, a.audience, public.announcement_group_ids(a.id), p.id)
  order by r.read_at nulls first, p.full_name
$$;
revoke execute on function public.announcement_audience(uuid) from public, anon;
grant execute on function public.announcement_audience(uuid) to authenticated, service_role;

-- Read stats for several announcements at once (only those the caller manages are returned).
create or replace function public.announcement_stats(p_ids uuid[])
  returns table (announcement_id uuid, total int, read int)
  language sql stable security definer set search_path = public as $$
  select a.id,
    (select count(distinct m.user_id)::int from memberships m
      where m.kindergarten_id = a.kindergarten_id and m.status = 'active' and m.user_id is distinct from a.author_id
        and public.audience_member(a.kindergarten_id, a.audience, public.announcement_group_ids(a.id), m.user_id)),
    (select count(*)::int from announcement_reads r
      where r.announcement_id = a.id and r.user_id is distinct from a.author_id
        and public.audience_member(a.kindergarten_id, a.audience, public.announcement_group_ids(a.id), r.user_id))
  from announcements a
  where a.id = any(p_ids) and public.announcement_manageable(a.id)
$$;
revoke execute on function public.announcement_stats(uuid[]) from public, anon;
grant execute on function public.announcement_stats(uuid[]) to authenticated, service_role;

-- "Напомнить": at most once per hour per announcement. Returns true when the caller may send now.
create or replace function public.claim_announcement_reminder(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.announcement_manageable(p_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update announcements set reminded_at = now()
  where id = p_id and (reminded_at is null or reminded_at < now() - interval '1 hour');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.claim_announcement_reminder(uuid) from public, anon;
grant execute on function public.claim_announcement_reminder(uuid) to authenticated, service_role;

-- Recipients of an event (for the reminder cron; service role only).
create or replace function public.event_recipients(p_id uuid) returns setof uuid
  language sql stable security definer set search_path = public as $$
  select distinct m.user_id
  from events e
  join memberships m on m.kindergarten_id = e.kindergarten_id and m.status = 'active'
  where e.id = p_id
    and public.audience_member(e.kindergarten_id, e.audience, public.event_group_ids(e.id), m.user_id)
$$;
revoke execute on function public.event_recipients(uuid) from public, anon, authenticated;
grant execute on function public.event_recipients(uuid) to service_role;

-- Atomically marks events of `p_date` in a kindergarten as reminded and returns them (idempotent cron).
create or replace function public.claim_event_reminders(p_kg uuid, p_date date)
  returns setof public.events
  language sql volatile security definer set search_path = public as $$
  update events set reminded_for = date, reminded_at = now()
  where kindergarten_id = p_kg and date = p_date and reminded_for is distinct from date
  returning *
$$;
revoke execute on function public.claim_event_reminders(uuid, date) from public, anon, authenticated;
grant execute on function public.claim_event_reminders(uuid, date) to service_role;

-- Birthdays in [p_from, p_to] (≤ 400 days) the current user may see (SPEC §5.6):
--   owner/head/accountant: all active children + staff; teacher: children of own groups + staff;
--   parent: own children only; club_teacher/cook: none. Roles of one person are combined.
--   Staff rows never expose the year of birth (birth_date and age are null).
create or replace function public.calendar_birthdays(p_kg uuid, p_from date, p_to date)
  returns table (kind text, person_id uuid, full_name text, birth_date date, day date, age int, group_name text)
  language sql stable security definer set search_path = public as $$
  with yrs as (
    select generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y
  ),
  people as (
    select 'child'::text as kind, c.id as person_id, c.full_name, c.birth_date, g.name as group_name
    from children c left join groups g on g.id = c.group_id
    where c.kindergarten_id = p_kg and c.status = 'active'
      and (public.has_role(p_kg, array['owner','head','accountant']::public.app_role[])
           or public.teaches_group(c.group_id)
           or public.is_guardian(c.id))
    union all
    select 'staff', p.id, p.full_name, p.birth_date, null
    from profiles p
    where p.birth_date is not null
      and public.has_role(p_kg, array['owner','head','accountant','teacher']::public.app_role[])
      and exists (select 1 from memberships m where m.user_id = p.id and m.kindergarten_id = p_kg
                  and m.status = 'active' and m.role <> 'parent')
  )
  select x.kind, x.person_id, x.full_name,
         case when x.kind = 'child' then x.birth_date end, d.day,
         case when x.kind = 'child' then (extract(year from d.day) - extract(year from x.birth_date))::int end,
         x.group_name
  from people x
  cross join yrs
  cross join lateral (select (x.birth_date + make_interval(years => yrs.y - extract(year from x.birth_date)::int))::date as day) d
  where p_to >= p_from and p_to - p_from <= 400
    and public.is_member(p_kg)
    and d.day between p_from and p_to
    and d.day > x.birth_date
  order by d.day, x.kind, x.full_name
$$;
revoke execute on function public.calendar_birthdays(uuid, date, date) from public, anon;
grant execute on function public.calendar_birthdays(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── Storage ─────────────────────────────
-- Private bucket; only the server (service role) touches it after its own checks, reads via signed URLs.
insert into storage.buckets (id, name, public) values ('announcements', 'announcements', false)
on conflict (id) do nothing;

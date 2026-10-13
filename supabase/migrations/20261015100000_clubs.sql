-- Stage 4A · Clubs and courses (SPEC §5.10). Free of charge — no money anywhere.
--
-- clubs             — catalog: name, description, photo (private bucket club-photos), club teacher, age range in full
--                     years (inclusive), weekly schedule (jsonb [{day 1..7, start "HH:MM", end "HH:MM"}]), place, capacity.
-- club_enrollments  — one row per attempt of a child to join a club. Status machine:
--                       requested ──confirm──▶ active ──leave (parent)──▶ left
--                           │  └──confirm, no place──▶ queued         └──exclude (admin)──▶ excluded
--                           └──reject──▶ rejected     queued ──confirm (its turn, place free)──▶ active
--                                                     queued ──reject──▶ rejected / ──leave──▶ left
--                     At most one open row (requested / queued / active) per club and child.
-- Queue: `queue_no` comes from a sequence when the row enters the queue, so the order is strict and deterministic.
--   free places = capacity − active children. The queue has priority over new requests:
--   - a new request becomes `queued` at once when free ≤ queued (no place left for it);
--   - confirming a request needs free > queued, otherwise it goes to the end of the queue;
--   - confirming a queued child needs its position ≤ free (nobody can be skipped).
-- Race safety: every transition is a SECURITY DEFINER function that first locks the club row (`for update`), so
-- capacity checks and queue numbering for one club are serialised. Clients have no write grants on enrollments.

-- ───────────────────────────── Tables ─────────────────────────────
create or replace function public.club_schedule_valid(s jsonb) returns boolean
  language sql immutable set search_path = public as $$
  select jsonb_typeof(s) = 'array' and jsonb_array_length(s) <= 14
    and not exists (
      select 1 from jsonb_array_elements(s) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e ->> 'day', '') !~ '^[1-7]$'
         or coalesce(e ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(e ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (e ->> 'start') >= (e ->> 'end'))
$$;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  description text check (description is null or length(description) <= 2000),
  -- files live under <kindergarten>/clubs/ — a row can never point at someone else's object
  photo_path text check (photo_path is null or photo_path like kindergarten_id::text || '/clubs/%'),
  teacher_id uuid references public.profiles(id) on delete set null,
  age_from int not null check (age_from between 0 and 17),
  age_to int not null check (age_to between 0 and 17),
  schedule jsonb not null default '[]'::jsonb check (public.club_schedule_valid(schedule)),
  place text check (place is null or length(place) <= 120),
  capacity int not null check (capacity between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (age_to >= age_from)
);
create index clubs_kg_idx on public.clubs (kindergarten_id, name);
create index clubs_teacher_idx on public.clubs (teacher_id);

create sequence public.club_queue_seq;

create table public.club_enrollments (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  status text not null check (status in ('requested', 'queued', 'active', 'rejected', 'left', 'excluded')),
  queue_no bigint, -- set when the row enters the queue (sequence → strict order); kept for history
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  started_on timestamptz, -- became active
  ended_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'queued' or queue_no is not null)
);
create unique index club_enrollments_open_uniq on public.club_enrollments (club_id, child_id)
  where status in ('requested', 'queued', 'active');
create index club_enrollments_club_idx on public.club_enrollments (club_id, status, queue_no);
create index club_enrollments_child_idx on public.club_enrollments (child_id, status);
create index club_enrollments_kg_idx on public.club_enrollments (kindergarten_id, status);

-- ───────────────────────────── Helpers ─────────────────────────────
-- Does the current user teach this club (active club_teacher membership)?
create or replace function public.club_teaches(p_club uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clubs c
    where c.id = p_club and c.teacher_id = auth.uid()
      and public.has_role(c.kindergarten_id, array['club_teacher']::public.app_role[]))
$$;

-- May the current user see the whole catalog of this garden? Cook: no; club teacher: only own clubs (SPEC §3.4).
create or replace function public.club_catalog_visible(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner','head','accountant','teacher','parent']::public.app_role[])
$$;

-- Free places of a club right now (archived children never hold a place).
create or replace function public.club_free_places(p_club uuid) returns int
  language sql stable security definer set search_path = public as $$
  select c.capacity - (
    select count(*)::int from club_enrollments e join children ch on ch.id = e.child_id and ch.status = 'active'
    where e.club_id = c.id and e.status = 'active')
  from clubs c where c.id = p_club
$$;

create or replace function public.club_queued_count(p_club uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from club_enrollments where club_id = p_club and status = 'queued'
$$;

-- Child's age in full years today (garden time zone).
create or replace function public.club_child_age(p_child uuid) returns int
  language sql stable security definer set search_path = public as $$
  select extract(year from age(public.kg_today(ch.kindergarten_id), ch.birth_date))::int from children ch where ch.id = p_child
$$;

-- Internal: no caller check inside, so only the SECURITY DEFINER transitions below may call them (they run as the owner).
-- Clients read counters through club_stats / club_roster, which check the caller.
revoke execute on function public.club_free_places(uuid) from public, anon, authenticated;
revoke execute on function public.club_queued_count(uuid) from public, anon, authenticated;
revoke execute on function public.club_child_age(uuid) from public, anon, authenticated;

-- ───────────────────────────── Integrity ─────────────────────────────
create or replace function public.tg_club_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare active_n int;
begin
  if tg_op = 'UPDATE' and new.kindergarten_id <> old.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  -- the club teacher must be an active club teacher of the same garden
  if new.teacher_id is not null and (tg_op = 'INSERT' or new.teacher_id is distinct from old.teacher_id)
     and not exists (select 1 from memberships m where m.user_id = new.teacher_id and m.kindergarten_id = new.kindergarten_id
                       and m.role = 'club_teacher' and m.status = 'active') then
    raise exception 'hs:clubTeacherInvalid';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.capacity < old.capacity then
      select count(*) into active_n from club_enrollments e join children ch on ch.id = e.child_id and ch.status = 'active'
        where e.club_id = new.id and e.status = 'active';
      if new.capacity < active_n then
        raise exception 'hs:clubCapacityBelowActive';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger clubs_guard before insert or update on public.clubs
  for each row execute function public.tg_club_guard();

-- Serialises capacity changes with enrollment transitions (both lock the club row first).
create or replace function public.tg_enrollment_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from clubs where id = new.club_id) is distinct from new.kindergarten_id
     or (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.club_id <> old.club_id or new.child_id <> old.child_id or new.kindergarten_id <> old.kindergarten_id) then
    raise exception 'enrollment identity is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger club_enrollments_guard before insert or update on public.club_enrollments
  for each row execute function public.tg_enrollment_guard();

-- An archived child leaves all clubs (the place is freed; queue/requests are closed).
create or replace function public.tg_child_archived_clubs() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'archived' and old.status <> 'archived' then
    update club_enrollments set status = 'left', ended_at = now(), ended_by = auth.uid()
      where child_id = new.id and status in ('requested', 'queued', 'active');
  end if;
  return new;
end $$;
create trigger children_archived_clubs after update of status on public.children
  for each row execute function public.tg_child_archived_clubs();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.clubs enable row level security;
alter table public.club_enrollments enable row level security;

-- Catalog: everyone of the garden except the cook; a club teacher — own clubs (SPEC §3.4). Writes: owner / head.
create policy clubs_select on public.clubs for select to authenticated
  using (public.club_catalog_visible(kindergarten_id) or public.club_teaches(id));
create policy clubs_insert on public.clubs for insert to authenticated with check (public.is_admin(kindergarten_id));
create policy clubs_update on public.clubs for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy clubs_delete on public.clubs for delete to authenticated using (public.is_admin(kindergarten_id));
revoke insert, update on public.clubs from authenticated;
grant insert (kindergarten_id, name, description, photo_path, teacher_id, age_from, age_to, schedule, place, capacity) on public.clubs to authenticated;
grant update (name, description, photo_path, teacher_id, age_from, age_to, schedule, place, capacity) on public.clubs to authenticated;

-- Enrollments: admins and the accountant (👁) — all; the club teacher — own clubs; a teacher — children of own
-- groups (👁); a parent — own children. Nobody writes directly: the functions below do.
create policy club_enrollments_select on public.club_enrollments for select to authenticated using (
  public.has_role(kindergarten_id, array['owner','head','accountant']::public.app_role[])
  or public.club_teaches(club_id)
  or public.is_guardian(child_id)
  or public.teaches_child(child_id)
);
revoke insert, update, delete on public.club_enrollments from authenticated;

-- ───────────────────────────── Cross-module access (only additions) ─────────────────────────────
-- Children: no widening of child_visible / children policies. A club teacher reads the children of own clubs only
-- through club_roster (name, age; contacts and allergies for enrolled children) — SPEC §3.4 «записанные».

-- Chats: a parent may also start a direct chat with the club teacher of a club their child attends.
-- Branches copied verbatim from 20261014100000_chats.sql; only the last one is new.
create or replace function public.chat_may_start(kg uuid, p_from uuid, p_to uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_from is not null and p_to is not null and p_from <> p_to and public.kg_is_open(kg)
    and exists (select 1 from memberships m where m.user_id = p_from and m.kindergarten_id = kg and m.status = 'active')
    and exists (select 1 from memberships m where m.user_id = p_to and m.kindergarten_id = kg and m.status = 'active')
    and (
      public.chat_is_staff_uid(kg, p_from)
      or public.chat_has_role_uid(kg, p_to, array['owner','head']::public.app_role[])
      or exists (
        select 1 from child_guardians cg
        join children c on c.id = cg.child_id and c.status = 'active' and c.kindergarten_id = kg
        join memberships pm on pm.user_id = cg.user_id and pm.kindergarten_id = kg and pm.role = 'parent' and pm.status = 'active'
        where cg.user_id = p_from and public.chat_teaches_uid(c.group_id, p_to))
      or exists (
        select 1 from child_guardians cg
        join children c on c.id = cg.child_id and c.status = 'active' and c.kindergarten_id = kg
        join memberships pm on pm.user_id = cg.user_id and pm.kindergarten_id = kg and pm.role = 'parent' and pm.status = 'active'
        join club_enrollments e on e.child_id = c.id and e.status = 'active'
        join clubs cl on cl.id = e.club_id and cl.kindergarten_id = kg
        where cg.user_id = p_from and cl.teacher_id = p_to
          and public.chat_has_role_uid(kg, p_to, array['club_teacher']::public.app_role[]))
    )
$$;

-- ───────────────────────────── Transitions ─────────────────────────────
-- Locks the club (serialises everything that touches its places) and returns it.
create or replace function public.club_lock(p_club uuid) returns public.clubs
  language plpgsql security definer set search_path = public as $$
declare c clubs;
begin
  select * into c from clubs where id = p_club for update;
  if c.id is null then
    raise exception 'hs:notFound';
  end if;
  return c;
end $$;
revoke execute on function public.club_lock(uuid) from public, anon, authenticated;

-- 1-based position of a queued enrollment in its club's queue.
create or replace function public.club_queue_pos(p_enrollment uuid) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from club_enrollments q join club_enrollments e on e.id = p_enrollment
  where q.club_id = e.club_id and q.status = 'queued' and e.status = 'queued' and q.queue_no <= e.queue_no
$$;
revoke execute on function public.club_queue_pos(uuid) from public, anon, authenticated;

-- Result of every transition: {id, status, position (queued only), freed (a place became free), queued (queue length)}.
create or replace function public.club_result(p_enrollment uuid, p_freed boolean) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'club_id', e.club_id, 'child_id', e.child_id, 'status', e.status,
    'position', case when e.status = 'queued' then public.club_queue_pos(e.id) end,
    'freed', p_freed and public.club_free_places(e.club_id) > 0,
    'queued', public.club_queued_count(e.club_id))
  from club_enrollments e where e.id = p_enrollment
$$;
revoke execute on function public.club_result(uuid, boolean) from public, anon, authenticated;

-- Parent: «Записаться». Free place (not reserved by the queue) → request; otherwise → queue.
create or replace function public.club_request(p_club uuid, p_child uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare c clubs; ch children; age_y int; new_id uuid; st text;
begin
  select * into ch from children where id = p_child;
  if ch.id is null or not public.is_guardian(p_child) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  c := public.club_lock(p_club);
  if c.kindergarten_id <> ch.kindergarten_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if ch.status <> 'active' then
    raise exception 'hs:notFound';
  end if;
  age_y := public.club_child_age(p_child);
  if age_y < c.age_from or age_y > c.age_to then
    raise exception 'hs:clubAge';
  end if;
  if exists (select 1 from club_enrollments where club_id = p_club and child_id = p_child and status in ('requested', 'queued', 'active')) then
    raise exception 'hs:clubAlreadyEnrolled';
  end if;
  st := case when public.club_free_places(p_club) > public.club_queued_count(p_club) then 'requested' else 'queued' end;
  insert into club_enrollments (kindergarten_id, club_id, child_id, status, queue_no, requested_by)
  values (c.kindergarten_id, p_club, p_child, st, case when st = 'queued' then nextval('club_queue_seq') end, auth.uid())
  returning id into new_id;
  return public.club_result(new_id, false);
end $$;

-- Owner/head or the club's teacher: confirm a request or the next child of the queue.
create or replace function public.club_confirm(p_enrollment uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e club_enrollments; c clubs; free int; queued int; pos int;
begin
  select * into e from club_enrollments where id = p_enrollment;
  if e.id is null then
    raise exception 'hs:notFound';
  end if;
  if not (public.is_admin(e.kindergarten_id) or public.club_teaches(e.club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  c := public.club_lock(e.club_id);
  select * into e from club_enrollments where id = p_enrollment for update; -- re-read under the club lock
  if e.status not in ('requested', 'queued') then
    raise exception 'hs:clubStateChanged';
  end if;
  free := public.club_free_places(c.id);
  queued := public.club_queued_count(c.id);
  if e.status = 'requested' then
    if free > queued then
      update club_enrollments set status = 'active', started_on = now(), decided_by = auth.uid(), decided_at = now() where id = e.id;
    else
      -- no place left for it: automatically to the end of the queue (SPEC §5.10)
      update club_enrollments set status = 'queued', queue_no = nextval('club_queue_seq') where id = e.id;
    end if;
  else
    if free <= 0 then
      raise exception 'hs:clubFull';
    end if;
    pos := public.club_queue_pos(e.id);
    if pos > free then
      raise exception 'hs:clubQueueOrder';
    end if;
    update club_enrollments set status = 'active', started_on = now(), decided_by = auth.uid(), decided_at = now() where id = e.id;
  end if;
  return public.club_result(e.id, false);
end $$;

-- Owner/head or the club's teacher: reject a request or a queued child.
create or replace function public.club_reject(p_enrollment uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e club_enrollments;
begin
  select * into e from club_enrollments where id = p_enrollment;
  if e.id is null then
    raise exception 'hs:notFound';
  end if;
  if not (public.is_admin(e.kindergarten_id) or public.club_teaches(e.club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.club_lock(e.club_id);
  update club_enrollments set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
    reason = nullif(trim(coalesce(p_reason, '')), '')
    where id = e.id and status in ('requested', 'queued');
  if not found then
    raise exception 'hs:clubStateChanged';
  end if;
  return public.club_result(e.id, false);
end $$;

-- Parent: unenrol (or withdraw a request / leave the queue).
create or replace function public.club_leave(p_enrollment uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e club_enrollments;
begin
  select * into e from club_enrollments where id = p_enrollment;
  if e.id is null or not public.is_guardian(e.child_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.club_lock(e.club_id);
  select * into e from club_enrollments where id = p_enrollment for update;
  if e.status not in ('requested', 'queued', 'active') then
    raise exception 'hs:clubStateChanged';
  end if;
  update club_enrollments set status = 'left', ended_by = auth.uid(), ended_at = now() where id = e.id;
  return public.club_result(e.id, e.status = 'active');
end $$;

-- Owner/head: exclude an active child (audited).
create or replace function public.club_exclude(p_enrollment uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e club_enrollments; c clubs;
begin
  select * into e from club_enrollments where id = p_enrollment;
  if e.id is null or not public.is_admin(e.kindergarten_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  c := public.club_lock(e.club_id);
  update club_enrollments set status = 'excluded', ended_by = auth.uid(), ended_at = now(),
    reason = nullif(trim(coalesce(p_reason, '')), '')
    where id = e.id and status = 'active';
  if not found then
    raise exception 'hs:clubStateChanged';
  end if;
  perform public.log_action(e.kindergarten_id, 'club.exclude', 'club_enrollment', e.id::text,
    jsonb_build_object('club', c.name, 'club_id', c.id, 'child', (select full_name from children where id = e.child_id),
                       'reason', nullif(trim(coalesce(p_reason, '')), '')));
  return public.club_result(e.id, true);
end $$;

-- ───────────────────────────── Read functions ─────────────────────────────
-- Place counters for the catalog (parents cannot read other children's enrollments, but may see the numbers).
create or replace function public.club_stats(p_kg uuid)
  returns table (club_id uuid, capacity int, active int, requested int, queued int, free int)
  language sql stable security definer set search_path = public as $$
  select c.id, c.capacity,
    count(*) filter (where e.status = 'active' and ch.status = 'active')::int,
    count(*) filter (where e.status = 'requested')::int,
    count(*) filter (where e.status = 'queued')::int,
    c.capacity - count(*) filter (where e.status = 'active' and ch.status = 'active')::int
  from clubs c
  left join club_enrollments e on e.club_id = c.id and e.status in ('active', 'requested', 'queued')
  left join children ch on ch.id = e.child_id
  where c.kindergarten_id = p_kg and (public.club_catalog_visible(p_kg) or public.club_teaches(c.id))
  group by c.id
$$;

-- Queue positions of the queued enrollments the caller may see (same rule as the select policy).
create or replace function public.club_queue_positions(p_kg uuid)
  returns table (enrollment_id uuid, club_id uuid, child_id uuid, queue_position int)
  language sql stable security definer set search_path = public as $$
  select q.id, q.club_id, q.child_id, q.pos
  from (
    select e.*, (row_number() over (partition by e.club_id order by e.queue_no))::int as pos
    from club_enrollments e where e.kindergarten_id = p_kg and e.status = 'queued'
  ) q
  join club_enrollments e on e.id = q.id
  where (
    public.has_role(p_kg, array['owner','head','accountant']::public.app_role[])
    or public.club_teaches(e.club_id) or public.is_guardian(e.child_id) or public.teaches_child(e.child_id))
$$;

-- Children of a club (open enrollments) with their parents' contacts — for owner/head/accountant and the club's teacher.
-- The club teacher gets group, allergies and parents' contacts only for enrolled («записанные», status active) children;
-- for requests and the queue — name and age only (SPEC §3.4). Birth dates are never returned, only the age.
create or replace function public.club_roster(p_club uuid)
  returns table (enrollment_id uuid, child_id uuid, child_name text, age int, group_name text, allergies text,
                 status text, queue_position int, requested_at timestamptz, started_on timestamptz, parents jsonb)
  language sql stable security definer set search_path = public as $$
  select e.id, ch.id, ch.full_name,
    extract(year from age(public.kg_today(c.kindergarten_id), ch.birth_date))::int,
    case when x.full then g.name end,
    case when x.full then ch.allergies end,
    e.status,
    case when e.status = 'queued' then (row_number() over (partition by e.status order by e.queue_no))::int end,
    e.created_at, e.started_on,
    case when x.full then
      coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', p.phone, 'relation', cg.relation) order by p.full_name)
                from child_guardians cg
                join profiles p on p.id = cg.user_id
                join memberships m on m.user_id = cg.user_id and m.kindergarten_id = cg.kindergarten_id and m.role = 'parent' and m.status = 'active'
                where cg.child_id = ch.id), '[]'::jsonb)
    else '[]'::jsonb end
  from clubs c
  cross join lateral (select public.has_role(c.kindergarten_id, array['owner','head','accountant']::public.app_role[]) as admin) r
  join club_enrollments e on e.club_id = c.id and e.status in ('requested', 'queued', 'active')
  cross join lateral (select r.admin or e.status = 'active' as full) x
  join children ch on ch.id = e.child_id and ch.status = 'active'
  left join groups g on g.id = ch.group_id
  where c.id = p_club and (r.admin or public.club_teaches(c.id))
  order by case e.status when 'requested' then 0 when 'queued' then 1 else 2 end, e.queue_no, e.created_at, ch.full_name
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'club_teaches(uuid)', 'club_catalog_visible(uuid)',
    'club_request(uuid, uuid)', 'club_confirm(uuid)', 'club_reject(uuid, text)', 'club_leave(uuid)', 'club_exclude(uuid, text)',
    'club_stats(uuid)', 'club_queue_positions(uuid)', 'club_roster(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────────── Storage ─────────────────────────────
-- Private bucket; only the server (service role) touches it after its own checks, reads via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-photos', 'club-photos', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

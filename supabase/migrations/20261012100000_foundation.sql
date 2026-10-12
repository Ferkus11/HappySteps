-- Stage 1 · Foundation: tenancy, roles, people, groups, children, audit, subscriptions.
-- Every table has RLS. Isolation by kindergarten_id through helper functions below.

-- ───────────────────────────── Types ─────────────────────────────
create type public.app_role as enum ('owner', 'head', 'accountant', 'teacher', 'club_teacher', 'cook', 'parent');
create type public.membership_status as enum ('active', 'archived');
create type public.kindergarten_status as enum ('active', 'blocked');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'blocked');
create type public.child_status as enum ('active', 'archived');

-- ───────────────────────────── Platform ─────────────────────────────
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.kindergartens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  status public.kindergarten_status not null default 'active',
  logo_path text,
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.kindergarten_settings (
  kindergarten_id uuid primary key references public.kindergartens(id) on delete cascade,
  timezone text not null default 'Asia/Almaty',
  default_locale text not null default 'ru' check (default_locale in ('ru', 'kk')),
  late_threshold_minutes int not null default 10 check (late_threshold_minutes between 0 and 180),
  attendance_reminder_time time not null default '10:00',
  attendance_escalation_time time not null default '11:00',
  payment_due_day int not null default 10 check (payment_due_day between 1 and 28),
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '08:00',
  meals text[] not null default array['breakfast', 'second_breakfast', 'lunch', 'snack'],
  address text,
  phone text,
  -- Owner-only fields (enforced by trigger below)
  requisites jsonb not null default '{}'::jsonb, -- {kaspi, iban, recipient, purpose, bank}
  consent_text text not null default '',
  updated_at timestamptz not null default now()
);

create table public.plans (
  code text primary key,
  name text not null,
  limits jsonb not null default '{}'::jsonb, -- e.g. {"children": 150} — not enforced yet (SPEC §10)
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  kindergarten_id uuid primary key references public.kindergartens(id) on delete cascade,
  plan text not null default 'trial' references public.plans(code),
  status public.subscription_status not null default 'trial',
  current_period_end date,
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── People ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  phone text not null unique check (phone ~ '^\+7[0-9]{10}$'),
  birth_date date,
  locale text not null default 'ru' check (locale in ('ru', 'kk')),
  last_context text,
  activated_at timestamptz, -- set when the person first sets a password via an invite
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  role public.app_role not null,
  status public.membership_status not null default 'active',
  position text, -- free-text job title for staff
  consent_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (user_id, kindergarten_id, role)
);
create index memberships_kg_idx on public.memberships (kindergarten_id, role, status);
create index memberships_user_idx on public.memberships (user_id, status);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kindergarten_id uuid references public.kindergartens(id) on delete cascade,
  kind text not null default 'invite' check (kind in ('invite', 'reset')),
  expires_at timestamptz not null default now() + interval '72 hours',
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invites_user_idx on public.invites (user_id);

create table public.login_attempts (
  id bigint generated always as identity primary key,
  phone text not null,
  ip text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_phone_idx on public.login_attempts (phone, created_at desc);
create index login_attempts_ip_idx on public.login_attempts (ip, created_at desc);

-- ───────────────────────────── Groups & children ─────────────────────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  age_category text,
  capacity int not null default 20 check (capacity between 1 and 200),
  color text not null default '#4FA3E0' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index groups_kg_idx on public.groups (kindergarten_id);

create table public.group_teachers (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  primary key (group_id, user_id)
);
create index group_teachers_user_idx on public.group_teachers (user_id);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  birth_date date not null,
  photo_path text,
  group_id uuid references public.groups(id) on delete restrict,
  enrolled_on date not null default current_date,
  allergies text,
  medical_notes text,
  monthly_fee numeric(12, 2) not null default 0 check (monthly_fee >= 0),
  status public.child_status not null default 'active',
  archive_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index children_kg_idx on public.children (kindergarten_id, status);
create index children_group_idx on public.children (group_id);

create table public.child_guardians (
  child_id uuid not null references public.children(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  relation text, -- мама, папа, бабушка …
  created_at timestamptz not null default now(),
  primary key (child_id, user_id)
);
create index child_guardians_user_idx on public.child_guardians (user_id);

create table public.child_group_history (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  from_date date not null,
  to_date date, -- inclusive; null = current
  created_at timestamptz not null default now(),
  check (to_date is null or to_date >= from_date)
);
create index child_group_history_child_idx on public.child_group_history (child_id, from_date);

-- ───────────────────────────── Audit ─────────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  kindergarten_id uuid references public.kindergartens(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_kg_idx on public.audit_log (kindergarten_id, created_at desc);

-- ───────────────────────────── Helper functions ─────────────────────────────
-- SECURITY DEFINER so they can read memberships without recursive RLS.

create or replace function public.is_superadmin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

create or replace function public.kg_is_open(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kindergartens k
    left join subscriptions s on s.kindergarten_id = k.id
    where k.id = kg and k.status = 'active' and coalesce(s.status, 'trial') <> 'blocked'
  )
$$;

create or replace function public.has_role(kg uuid, roles public.app_role[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.kindergarten_id = kg and m.status = 'active' and m.role = any(roles)
  ) and kg_is_open(kg)
$$;

create or replace function public.is_member(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m where m.user_id = auth.uid() and m.kindergarten_id = kg and m.status = 'active'
  ) and kg_is_open(kg)
$$;

create or replace function public.is_staff(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner','head','accountant','teacher','club_teacher','cook']::public.app_role[])
$$;

create or replace function public.is_admin(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner','head']::public.app_role[])
$$;

create or replace function public.my_kindergarten_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select distinct m.kindergarten_id from memberships m
  where m.user_id = auth.uid() and m.status = 'active' and kg_is_open(m.kindergarten_id)
$$;

create or replace function public.teaches_group(g uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_teachers gt
    join memberships m on m.user_id = gt.user_id and m.kindergarten_id = gt.kindergarten_id
      and m.role = 'teacher' and m.status = 'active'
    where gt.group_id = g and gt.user_id = auth.uid()
  ) and kg_is_open((select kindergarten_id from groups where id = g))
$$;

create or replace function public.is_guardian(c uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from child_guardians cg
    join memberships m on m.user_id = cg.user_id and m.kindergarten_id = cg.kindergarten_id
      and m.role = 'parent' and m.status = 'active'
    where cg.child_id = c and cg.user_id = auth.uid()
  ) and kg_is_open((select kindergarten_id from children where id = c))
$$;

create or replace function public.teaches_child(c uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.teaches_group((select group_id from children where id = c))
$$;

-- Section 3.3: can the current user create/archive a membership with this role?
create or replace function public.can_manage_role(kg uuid, target public.app_role) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when public.has_role(kg, array['owner']::public.app_role[]) then true
    when public.has_role(kg, array['head']::public.app_role[])
      then target in ('teacher', 'club_teacher', 'cook', 'parent')
    else false
  end
$$;

-- Child ids the current user may see (used by many module policies).
create or replace function public.child_visible(c uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from children ch
    where ch.id = c and (
      public.has_role(ch.kindergarten_id, array['owner','head','accountant']::public.app_role[])
      or public.teaches_group(ch.group_id)
      or public.is_guardian(ch.id)
    )
  )
$$;

-- Audit entry written on behalf of the current user (direct inserts are not allowed).
create or replace function public.log_action(kg uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if kg is not null and not public.is_member(kg) and not public.is_superadmin() then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into audit_log (kindergarten_id, actor_id, action, entity, entity_id, details)
  values (kg, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- Local "today" for a kindergarten (SPEC §8: everything in the kindergarten's time zone).
create or replace function public.kg_today(kg uuid) returns date
  language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty'))::date
$$;

create or replace function public.kg_now(kg uuid) returns timestamp
  language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty'))
$$;

-- ───────────────────────────── Login rate limiting (service role only) ─────────────────────────────
create or replace function public.login_attempts_check(p_phone text, p_ip text, p_window_minutes int, p_max_fails int)
  returns boolean language sql stable security definer set search_path = public as $$
  select (
    select count(*) from login_attempts
    where phone = p_phone and not success and created_at > now() - make_interval(mins => p_window_minutes)
      and created_at > coalesce((select max(created_at) from login_attempts where phone = p_phone and success), '-infinity')
  ) < p_max_fails
  and (
    select count(*) from login_attempts
    where ip = p_ip and not success and created_at > now() - make_interval(mins => p_window_minutes)
  ) < p_max_fails * 5
$$;

create or replace function public.login_attempts_record(p_phone text, p_ip text, p_success boolean)
  returns void language sql security definer set search_path = public as $$
  insert into login_attempts (phone, ip, success) values (p_phone, p_ip, p_success);
  delete from login_attempts where created_at < now() - interval '2 days';
$$;

revoke execute on function public.login_attempts_check(text, text, int, int) from public, anon, authenticated;
revoke execute on function public.login_attempts_record(text, text, boolean) from public, anon, authenticated;
grant execute on function public.login_attempts_check(text, text, int, int) to service_role;
grant execute on function public.login_attempts_record(text, text, boolean) to service_role;

-- ───────────────────────────── Integrity triggers ─────────────────────────────
-- Cannot archive/delete/demote the last active owner (SPEC §3.3).
create or replace function public.tg_protect_last_owner() returns trigger
  language plpgsql security definer set search_path = public as $$
declare kg uuid := coalesce(old.kindergarten_id, new.kindergarten_id);
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'owner') then
    if not exists (
      select 1 from memberships where kindergarten_id = kg and role = 'owner' and status = 'active' and id <> old.id
    ) then
      raise exception 'last_owner' using errcode = 'P0001', hint = 'Нельзя архивировать последнего владельца сада';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_protect_last_owner before update or delete on public.memberships
  for each row execute function public.tg_protect_last_owner();

-- Head may edit only operational settings; requisites/consent/billing are owner-only.
create or replace function public.tg_settings_owner_fields() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role(new.kindergarten_id, array['owner']::public.app_role[])
     and (new.requisites is distinct from old.requisites or new.consent_text is distinct from old.consent_text
          or new.timezone is distinct from old.timezone
          or new.payment_due_day is distinct from old.payment_due_day) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger kindergarten_settings_owner_fields before update on public.kindergarten_settings
  for each row execute function public.tg_settings_owner_fields();

-- Only owners (and superadmins) change kindergarten name/logo/accent; only superadmins change status.
create or replace function public.tg_kindergarten_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_superadmin() then return new; end if;
  if new.status is distinct from old.status or new.slug is distinct from old.slug then
    raise exception 'superadmin_only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger kindergartens_guard before update on public.kindergartens
  for each row execute function public.tg_kindergarten_guard();

-- Group with active children cannot be deleted (SPEC §5.1).
create or replace function public.tg_group_delete_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from children where group_id = old.id and status = 'active') then
    raise exception 'group_has_children' using errcode = 'P0001';
  end if;
  -- archived children keep history; detach them
  update children set group_id = null where group_id = old.id;
  return old;
end $$;
create trigger groups_delete_guard before delete on public.groups
  for each row execute function public.tg_group_delete_guard();

-- kindergarten_id of link tables must match the parent rows (no cross-tenant links).
create or replace function public.tg_same_kg_child_guardian() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger child_guardians_same_kg before insert or update on public.child_guardians
  for each row execute function public.tg_same_kg_child_guardian();

create or replace function public.tg_same_kg_group_teacher() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from groups where id = new.group_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger group_teachers_same_kg before insert or update on public.group_teachers
  for each row execute function public.tg_same_kg_group_teacher();

create or replace function public.tg_child_group_kg() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and (select kindergarten_id from groups where id = new.group_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.kindergarten_id <> old.kindergarten_id then
    raise exception 'kindergarten is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger children_group_kg before insert or update on public.children
  for each row execute function public.tg_child_group_kg();

-- History row for a new child.
create or replace function public.tg_child_history_on_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null then
    insert into child_group_history (kindergarten_id, child_id, group_id, from_date)
    values (new.kindergarten_id, new.id, new.group_id, new.enrolled_on);
  end if;
  return new;
end $$;
create trigger children_history_insert after insert on public.children
  for each row execute function public.tg_child_history_on_insert();

-- When all children of a parent are archived → archive the parent's membership (SPEC §4).
create or replace function public.tg_child_archive_parents() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'archived' and old.status = 'active' then
    update memberships m set status = 'archived', archived_at = now(), archived_by = auth.uid()
    where m.kindergarten_id = new.kindergarten_id and m.role = 'parent' and m.status = 'active'
      and m.user_id in (select user_id from child_guardians where child_id = new.id)
      and not exists (
        select 1 from child_guardians cg join children c on c.id = cg.child_id
        where cg.user_id = m.user_id and c.kindergarten_id = new.kindergarten_id and c.status = 'active'
      );
    update child_group_history set to_date = greatest(from_date, public.kg_today(new.kindergarten_id))
      where child_id = new.id and to_date is null;
  elsif new.status = 'active' and old.status = 'archived' then
    update memberships m set status = 'active', archived_at = null, archived_by = null
    where m.kindergarten_id = new.kindergarten_id and m.role = 'parent' and m.status = 'archived'
      and m.user_id in (select user_id from child_guardians where child_id = new.id);
    if new.group_id is not null then
      insert into child_group_history (kindergarten_id, child_id, group_id, from_date)
      values (new.kindergarten_id, new.id, new.group_id, public.kg_today(new.kindergarten_id));
    end if;
  end if;
  return new;
end $$;
create trigger children_archive_parents after update of status on public.children
  for each row execute function public.tg_child_archive_parents();

create or replace function public.tg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.tg_touch_updated_at();

-- ───────────────────────────── Domain functions ─────────────────────────────
-- Transfer a child to another group from a date; history stays with the old group (SPEC §5.1).
create or replace function public.transfer_child(p_child uuid, p_group uuid, p_date date)
  returns void language plpgsql security definer set search_path = public as $$
declare c children;
begin
  select * into c from children where id = p_child for update;
  if c.id is null or not public.is_admin(c.kindergarten_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (select kindergarten_id from groups where id = p_group) is distinct from c.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if c.group_id = p_group then return; end if;
  update child_group_history set to_date = greatest(from_date, p_date - 1)
    where child_id = p_child and to_date is null;
  delete from child_group_history where child_id = p_child and from_date >= p_date;
  insert into child_group_history (kindergarten_id, child_id, group_id, from_date)
    values (c.kindergarten_id, p_child, p_group, p_date);
  update children set group_id = p_group where id = p_child;
  perform public.log_action(c.kindergarten_id, 'child.transfer', 'child', p_child::text,
    jsonb_build_object('from_group', c.group_id, 'to_group', p_group, 'date', p_date));
end $$;

-- Move all active children of a group (e.g. September promotion).
create or replace function public.transfer_group(p_from uuid, p_to uuid, p_date date)
  returns int language plpgsql security definer set search_path = public as $$
declare kg uuid; n int := 0; r record;
begin
  select kindergarten_id into kg from groups where id = p_from;
  if kg is null or not public.is_admin(kg) or (select kindergarten_id from groups where id = p_to) is distinct from kg then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select id from children where group_id = p_from and status = 'active' loop
    perform public.transfer_child(r.id, p_to, p_date);
    n := n + 1;
  end loop;
  perform public.log_action(kg, 'group.transfer', 'group', p_from::text, jsonb_build_object('to_group', p_to, 'date', p_date, 'children', n));
  return n;
end $$;

-- Group id of a child on a given date (attendance history stays bound to the group of that date).
create or replace function public.child_group_on(p_child uuid, p_date date) returns uuid
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select group_id from child_group_history
      where child_id = p_child and from_date <= p_date and (to_date is null or to_date >= p_date)
      order by from_date desc limit 1),
    (select group_id from children where id = p_child)
  )
$$;
revoke execute on function public.child_group_on(uuid, date) from public, anon;
grant execute on function public.child_group_on(uuid, date) to authenticated, service_role;

-- Allergy list for the kitchen without exposing other child data (SPEC §3.4: cook 👁 аллергии).
create or replace function public.kitchen_allergies(kg uuid)
  returns table (child_id uuid, full_name text, group_id uuid, group_name text, allergies text)
  language sql stable security definer set search_path = public as $$
  select c.id, c.full_name, g.id, g.name, c.allergies
  from children c left join groups g on g.id = c.group_id
  where c.kindergarten_id = kg and c.status = 'active' and coalesce(trim(c.allergies), '') <> ''
    and public.has_role(kg, array['owner','head','accountant','teacher','cook']::public.app_role[])
  order by g.sort_order, g.name, c.full_name
$$;

-- Superadmin overview (SPEC §9).
create or replace function public.admin_kindergartens()
  returns table (id uuid, name text, slug text, status public.kindergarten_status, created_at timestamptz,
                 owner_name text, owner_phone text, children_count bigint, staff_count bigint,
                 plan text, subscription_status public.subscription_status, current_period_end date)
  language sql stable security definer set search_path = public as $$
  select k.id, k.name, k.slug, k.status, k.created_at,
    (select p.full_name from memberships m join profiles p on p.id = m.user_id
      where m.kindergarten_id = k.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
    (select p.phone from memberships m join profiles p on p.id = m.user_id
      where m.kindergarten_id = k.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
    (select count(*) from children c where c.kindergarten_id = k.id and c.status = 'active'),
    (select count(distinct m.user_id) from memberships m where m.kindergarten_id = k.id and m.status = 'active' and m.role <> 'parent'),
    s.plan, s.status, s.current_period_end
  from kindergartens k left join subscriptions s on s.kindergarten_id = k.id
  where public.is_superadmin()
  order by k.created_at desc
$$;

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.platform_admins enable row level security;
alter table public.kindergartens enable row level security;
alter table public.kindergarten_settings enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.login_attempts enable row level security;
alter table public.groups enable row level security;
alter table public.group_teachers enable row level security;
alter table public.children enable row level security;
alter table public.child_guardians enable row level security;
alter table public.child_group_history enable row level security;
alter table public.audit_log enable row level security;

-- platform_admins: a user can see whether they are a superadmin.
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- kindergartens
create policy kg_select on public.kindergartens for select to authenticated
  using (public.is_superadmin() or exists (
    select 1 from memberships m where m.kindergarten_id = kindergartens.id and m.user_id = auth.uid() and m.status = 'active'));
create policy kg_update on public.kindergartens for update to authenticated
  using (public.is_superadmin() or public.has_role(id, array['owner']::public.app_role[]))
  with check (public.is_superadmin() or public.has_role(id, array['owner']::public.app_role[]));
create policy kg_insert on public.kindergartens for insert to authenticated with check (public.is_superadmin());

-- settings
create policy settings_select on public.kindergarten_settings for select to authenticated
  using (public.is_member(kindergarten_id) or public.is_superadmin());
create policy settings_update on public.kindergarten_settings for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy settings_insert on public.kindergarten_settings for insert to authenticated with check (public.is_superadmin());

-- plans / subscriptions
create policy plans_select on public.plans for select to authenticated using (true);
create policy plans_write on public.plans for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy subs_select on public.subscriptions for select to authenticated
  using (public.is_superadmin() or public.has_role(kindergarten_id, array['owner']::public.app_role[]));
create policy subs_write on public.subscriptions for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- profiles: self; staff see people of their kindergartens; parents see staff and co-guardians.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from memberships target
    where target.user_id = profiles.id and target.kindergarten_id in (select public.my_kindergarten_ids())
      and (public.is_staff(target.kindergarten_id) or target.role <> 'parent')
  )
  or exists (
    select 1 from child_guardians mine join child_guardians other on other.child_id = mine.child_id
    where mine.user_id = auth.uid() and other.user_id = profiles.id and public.is_guardian(mine.child_id)
  )
);
-- Users may change only their own non-identity fields (column grants below).
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (locale, last_context, birth_date) on public.profiles to authenticated;

-- memberships
create policy memberships_select on public.memberships for select to authenticated using (
  user_id = auth.uid()
  or public.is_staff(kindergarten_id)
  or (role <> 'parent' and public.is_member(kindergarten_id))
);
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.can_manage_role(kindergarten_id, role));
create policy memberships_update on public.memberships for update to authenticated
  using (public.can_manage_role(kindergarten_id, role) or user_id = auth.uid())
  with check (public.can_manage_role(kindergarten_id, role) or user_id = auth.uid());
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_role(kindergarten_id, array['owner']::public.app_role[]));
-- Self-updates are limited to consent; status/role changes need can_manage_role (trigger).
create or replace function public.tg_membership_self_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_manage_role(old.kindergarten_id, old.role)
     and (new.role <> old.role or new.status <> old.status or new.user_id <> old.user_id
          or new.kindergarten_id <> old.kindergarten_id or new.position is distinct from old.position) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() is not null and new.role <> old.role and not public.can_manage_role(old.kindergarten_id, new.role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger memberships_self_update before update on public.memberships
  for each row execute function public.tg_membership_self_update();

-- invites / login_attempts: no policies → only the service role (server) can touch them.

-- groups
create policy groups_select on public.groups for select to authenticated using (public.is_member(kindergarten_id));
create policy groups_write on public.groups for all to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));

create policy group_teachers_select on public.group_teachers for select to authenticated using (public.is_member(kindergarten_id));
create policy group_teachers_write on public.group_teachers for all to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));

-- children
create policy children_select on public.children for select to authenticated using (
  public.has_role(kindergarten_id, array['owner','head','accountant']::public.app_role[])
  or public.teaches_group(group_id)
  or public.is_guardian(id)
);
create policy children_insert on public.children for insert to authenticated with check (public.is_admin(kindergarten_id));
create policy children_update on public.children for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy children_delete on public.children for delete to authenticated
  using (public.has_role(kindergarten_id, array['owner']::public.app_role[]));

create policy child_guardians_select on public.child_guardians for select to authenticated using (
  public.has_role(kindergarten_id, array['owner','head','accountant']::public.app_role[])
  or public.teaches_child(child_id)
  or public.is_guardian(child_id)
);
create policy child_guardians_write on public.child_guardians for all to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));

create policy child_group_history_select on public.child_group_history for select to authenticated
  using (public.child_visible(child_id));
create policy child_group_history_write on public.child_group_history for all to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));

-- audit log: owner full, head view (SPEC §3.4). Writes only via log_action().
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_admin(kindergarten_id) or (kindergarten_id is null and public.is_superadmin()));

-- ───────────────────────────── Seed reference data ─────────────────────────────
insert into public.plans (code, name, limits) values
  ('trial', 'Пробный', '{"children": 200, "staff": 50}'),
  ('basic', 'Базовый', '{"children": 150, "staff": 40}'),
  ('pro', 'Профессиональный', '{"children": 500, "staff": 150}');

-- Private storage buckets (SPEC §11). Access only through the server with signed URLs.
insert into storage.buckets (id, name, public) values
  ('child-photos', 'child-photos', false),
  ('kindergarten-assets', 'kindergarten-assets', false)
on conflict (id) do nothing;

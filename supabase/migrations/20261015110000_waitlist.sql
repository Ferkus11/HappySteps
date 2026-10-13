-- Stage 4B · Waitlist and the public application form (SPEC §5.11).
--
-- waitlist_applications — one row per application. Created either by an anonymous visitor through the public
--   form (the server validates, checks the honeypot and calls waitlist_public_submit() with the service role —
--   anonymous users get no table access at all) or manually by the administration (RLS insert, source = manual).
--   Status: new → contacted → accepted / declined. «accepted» is set only by waitlist_finish_accept(), together
--   with the created child (and parent), and is final.
--   Date bounds that depend on «today» (birth date not in the future, desired date within 3 years) are checked
--   by the guard trigger, not by CHECK constraints (those must stay true forever, «today» moves).
-- waitlist_comments — comments of the administration plus automatic status-change entries (kind = status).
-- waitlist_rate_limits — submissions of the public form per garden, IP hash and phone hash (service role only).
--
-- Visibility (§3.4): owner/head — full; accountant — read only; everybody else — nothing.

-- ───────────────────────────── Tables ─────────────────────────────
create table public.waitlist_applications (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  child_name text not null check (length(trim(child_name)) between 2 and 160),
  child_birth_date date not null check (child_birth_date > date '2000-01-01'),
  parent_name text not null check (length(trim(parent_name)) between 2 and 160),
  parent_phone text not null check (parent_phone ~ '^\+7\d{10}$'),
  desired_date date check (desired_date is null or desired_date > date '2000-01-01'),
  comment text check (comment is null or length(comment) <= 1000),
  source text not null default 'manual' check (source in ('public', 'manual')),
  status text not null default 'new' check (status in ('new', 'contacted', 'accepted', 'declined')),
  status_changed_at timestamptz not null default now(),
  -- set together by waitlist_finish_accept()
  child_id uuid references public.children(id) on delete set null,
  parent_user_id uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  -- double-click guard of «Принять»: set by waitlist_begin_accept(); only the attempt holding the token may finish
  accepting_since timestamptz,
  accepting_token uuid,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (status <> 'accepted' or accepted_at is not null)
);
create index waitlist_applications_kg_idx on public.waitlist_applications (kindergarten_id, status, created_at desc);
create index waitlist_applications_phone_idx on public.waitlist_applications (kindergarten_id, parent_phone);

create table public.waitlist_comments (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  application_id uuid not null references public.waitlist_applications(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  kind text not null default 'comment' check (kind in ('comment', 'status')),
  body text check (body is null or length(trim(body)) between 1 and 1000),
  status text check (status is null or status in ('new', 'contacted', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check ((kind = 'comment') = (body is not null)),
  check ((kind = 'status') = (status is not null))
);
create index waitlist_comments_app_idx on public.waitlist_comments (application_id, created_at);

create table public.waitlist_rate_limits (
  id bigint generated always as identity primary key,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  ip_hash text, -- null when the server could not determine the client IP (no IP limit then)
  phone_hash text not null,
  created_at timestamptz not null default now()
);
create index waitlist_rate_limits_kg_idx on public.waitlist_rate_limits (kindergarten_id, created_at desc);
create index waitlist_rate_limits_ip_idx on public.waitlist_rate_limits (kindergarten_id, ip_hash, created_at desc);
create index waitlist_rate_limits_phone_idx on public.waitlist_rate_limits (kindergarten_id, phone_hash, created_at desc);

-- ───────────────────────────── Integrity ─────────────────────────────
create or replace function public.tg_waitlist_application_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.child_id is not null and (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  -- Bounds relative to «today» (kindergarten time zone; +1 day of slack for clocks around midnight).
  if (tg_op = 'INSERT' or new.child_birth_date is distinct from old.child_birth_date)
     and new.child_birth_date > kg_today(new.kindergarten_id) + 1 then
    raise exception 'hs:dateInvalid';
  end if;
  if new.desired_date is not null and (tg_op = 'INSERT' or new.desired_date is distinct from old.desired_date)
     and new.desired_date > (kg_today(new.kindergarten_id) + interval '3 years')::date then
    raise exception 'hs:dateInvalid';
  end if;
  if tg_op = 'UPDATE' then
    if new.kindergarten_id <> old.kindergarten_id then
      raise exception 'kindergarten is immutable' using errcode = '42501';
    end if;
    -- «Принята» is final, and only the accept flow (which also links the child) can set it.
    if old.status = 'accepted' and new.status <> 'accepted' then
      raise exception 'hs:waitlistAccepted';
    end if;
    if new.status = 'accepted' and old.status <> 'accepted' and new.child_id is null then
      raise exception 'hs:invalid';
    end if;
    if new.status <> old.status then
      new.status_changed_at := now();
    end if;
  elsif new.status = 'accepted' then
    raise exception 'hs:invalid';
  end if;
  return new;
end $$;
create trigger waitlist_applications_guard before insert or update on public.waitlist_applications
  for each row execute function public.tg_waitlist_application_guard();

-- Every status change leaves an entry in the application's timeline.
create or replace function public.tg_waitlist_status_log() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into waitlist_comments (kindergarten_id, application_id, author_id, kind, status)
    values (new.kindergarten_id, new.id, auth.uid(), 'status', new.status);
  end if;
  return null;
end $$;
create trigger waitlist_applications_status_log after update of status on public.waitlist_applications
  for each row execute function public.tg_waitlist_status_log();

create or replace function public.tg_waitlist_comment_same_kg() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from waitlist_applications where id = new.application_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger waitlist_comments_same_kg before insert or update on public.waitlist_comments
  for each row execute function public.tg_waitlist_comment_same_kg();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.waitlist_applications enable row level security;
alter table public.waitlist_comments enable row level security;
alter table public.waitlist_rate_limits enable row level security;

create policy waitlist_applications_select on public.waitlist_applications for select to authenticated
  using (public.has_role(kindergarten_id, array['owner', 'head', 'accountant']::public.app_role[]));
create policy waitlist_applications_insert on public.waitlist_applications for insert to authenticated
  with check (public.is_admin(kindergarten_id) and source = 'manual' and status = 'new' and created_by = auth.uid());
create policy waitlist_applications_update on public.waitlist_applications for update to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));
create policy waitlist_applications_delete on public.waitlist_applications for delete to authenticated
  using (public.is_admin(kindergarten_id) and status <> 'accepted');

-- Clients may write only the application's own data and its status; links to the child/parent, the source and
-- service columns are written by the functions below.
revoke insert, update on public.waitlist_applications from anon, authenticated;
grant insert (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, desired_date, comment)
  on public.waitlist_applications to authenticated;
grant update (child_name, child_birth_date, parent_name, parent_phone, desired_date, comment, status)
  on public.waitlist_applications to authenticated;

create policy waitlist_comments_select on public.waitlist_comments for select to authenticated
  using (public.has_role(kindergarten_id, array['owner', 'head', 'accountant']::public.app_role[]));
create policy waitlist_comments_insert on public.waitlist_comments for insert to authenticated
  with check (public.is_admin(kindergarten_id) and kind = 'comment' and author_id = auth.uid());
create policy waitlist_comments_delete on public.waitlist_comments for delete to authenticated
  using (public.is_admin(kindergarten_id) and kind = 'comment' and author_id = auth.uid());
revoke insert, update on public.waitlist_comments from anon, authenticated;
grant insert (kindergarten_id, application_id, body) on public.waitlist_comments to authenticated;

-- Rate-limit log: RLS without policies (reads return nothing) and no write grants — only the service role
-- (and the security definer function below) touch it.
revoke insert, update, delete, truncate on public.waitlist_rate_limits from anon, authenticated;
revoke insert, update, delete, truncate on public.waitlist_applications, public.waitlist_comments from anon;

-- ───────────────────────────── Public form (service role only) ─────────────────────────────
-- Called by the server after zod validation and the honeypot check. Limits (window in the DB), per garden:
--   per IP hash   — p_ip_max submissions per hour from one IP to this garden (skipped when the IP is unknown);
--   per garden    — p_kg_max submissions per hour in total (caps a spam wave from many IPs);
--   per phone     — p_phone_max submissions per 24 hours in this garden.
-- A repeated application (same phone, child name and birth date, still waiting) is not duplicated.
-- Returns { id, created } or raises hs:tooManyApplications / hs:notFound.
create or replace function public.waitlist_public_submit(
  p_kg uuid,
  p_child_name text,
  p_birth date,
  p_parent_name text,
  p_phone text,
  p_desired date,
  p_comment text,
  p_ip_hash text,
  p_phone_hash text,
  p_ip_max int default 10,
  p_kg_max int default 60,
  p_phone_max int default 3
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not kg_is_open(p_kg) then
    raise exception 'hs:notFound';
  end if;
  -- Serialise submissions to one garden so parallel requests cannot slip past the limits.
  perform pg_advisory_xact_lock(hashtextextended('waitlist:' || p_kg::text, 0));
  if (p_ip_hash is not null and (select count(*) from waitlist_rate_limits
         where kindergarten_id = p_kg and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= p_ip_max)
     or (select count(*) from waitlist_rate_limits
         where kindergarten_id = p_kg and created_at > now() - interval '1 hour') >= p_kg_max
     or (select count(*) from waitlist_rate_limits
         where kindergarten_id = p_kg and phone_hash = p_phone_hash and created_at > now() - interval '24 hours') >= p_phone_max then
    raise exception 'hs:tooManyApplications';
  end if;
  insert into waitlist_rate_limits (kindergarten_id, ip_hash, phone_hash) values (p_kg, p_ip_hash, p_phone_hash);
  delete from waitlist_rate_limits where kindergarten_id = p_kg and created_at < now() - interval '2 days';

  select id into v_id from waitlist_applications
  where kindergarten_id = p_kg and parent_phone = p_phone and status in ('new', 'contacted')
    and lower(trim(child_name)) = lower(trim(p_child_name)) and child_birth_date = p_birth
  limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;

  insert into waitlist_applications (kindergarten_id, child_name, child_birth_date, parent_name, parent_phone, desired_date, comment, source, created_by)
  values (p_kg, trim(p_child_name), p_birth, trim(p_parent_name), p_phone, p_desired, nullif(trim(coalesce(p_comment, '')), ''), 'public', null)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
end $$;
revoke execute on function public.waitlist_public_submit(uuid, text, date, text, text, date, text, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.waitlist_public_submit(uuid, text, date, text, text, date, text, text, text, int, int, int) to service_role;

-- ───────────────────────────── «Принять» ─────────────────────────────
-- The server (owner/head) runs:
--   1. waitlist_begin_accept()  — claims the application and gets a one-time claim token;
--   2. finds or creates the parent's auth account (service role — the only step outside the database);
--   3. waitlist_accept()        — one transaction: parent membership, child card, guardian link, «Принята», audit;
--   4. on failure: waitlist_abort_accept() releases the claim, and the server deletes an auth account it created
--      in step 2. Nothing else needs a rollback: step 3 either happened completely or not at all.
--
-- Step 1. Returns { state, token }:
--   'ok'       — claimed; token must be passed to waitlist_accept() / waitlist_abort_accept();
--   'accepted' — already accepted (the caller shows the existing child);
--   'busy'     — someone else is accepting it right now (a claim expires after 2 minutes and can be taken over —
--                the old attempt then cannot finish, its token no longer matches).
create or replace function public.waitlist_begin_accept(p_app uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  a waitlist_applications;
  v_token uuid := gen_random_uuid();
begin
  select * into a from waitlist_applications where id = p_app for update;
  if a.id is null or not is_admin(a.kindergarten_id) then
    raise exception 'hs:notFound';
  end if;
  if a.status = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'child_id', a.child_id);
  end if;
  if a.accepting_since is not null and a.accepting_since > now() - interval '2 minutes' then
    return jsonb_build_object('state', 'busy');
  end if;
  update waitlist_applications set accepting_since = now(), accepting_token = v_token where id = p_app;
  return jsonb_build_object('state', 'ok', 'token', v_token);
end $$;

-- Step 3. Everything that belongs to the garden, in one transaction, with the caller's checks:
-- owner/head of the application's garden, the claim token held, the group in the same garden, the parent may be
-- added by the caller (can_manage_role). Returns the new child's id.
create or replace function public.waitlist_accept(
  p_app uuid,
  p_token uuid,
  p_child_name text,
  p_birth date,
  p_group uuid,
  p_enrolled date,
  p_fee numeric,
  p_parent uuid,
  p_parent_new boolean default false
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  a waitlist_applications;
  v_kg uuid;
  v_child uuid;
  v_member memberships;
begin
  select * into a from waitlist_applications where id = p_app for update;
  if a.id is null or not is_admin(a.kindergarten_id) then
    raise exception 'hs:notFound';
  end if;
  v_kg := a.kindergarten_id;
  if a.status = 'accepted' then
    raise exception 'hs:waitlistAccepted';
  end if;
  if p_token is null or a.accepting_token is distinct from p_token then
    raise exception 'hs:waitlistBusy';
  end if;
  if p_group is null or not exists (select 1 from groups where id = p_group and kindergarten_id = v_kg) then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if p_birth is null or p_birth > kg_today(v_kg) then
    raise exception 'hs:dateInvalid';
  end if;

  -- The parent: an active «parent» membership in this garden (created or re-activated).
  if p_parent is not null then
    if not can_manage_role(v_kg, 'parent') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not exists (select 1 from profiles where id = p_parent) then
      raise exception 'hs:notFound';
    end if;
    select * into v_member from memberships
    where user_id = p_parent and kindergarten_id = v_kg and role = 'parent' for update;
    if v_member.id is null then
      insert into memberships (user_id, kindergarten_id, role, created_by) values (p_parent, v_kg, 'parent', auth.uid());
    elsif v_member.status = 'archived' then
      update memberships set status = 'active', archived_at = null, archived_by = null where id = v_member.id;
    end if;
    if v_member.id is null or v_member.status = 'archived' then
      perform log_action(v_kg, 'account.create', 'membership', p_parent::text,
        jsonb_build_object('role', 'parent', 'existed', not coalesce(p_parent_new, false)));
    end if;
  end if;

  insert into children (kindergarten_id, full_name, birth_date, group_id, enrolled_on, monthly_fee)
  values (v_kg, trim(p_child_name), p_birth, p_group, p_enrolled, coalesce(p_fee, 0))
  returning id into v_child;
  perform log_action(v_kg, 'child.create', 'child', v_child::text, jsonb_build_object('name', trim(p_child_name)));

  if p_parent is not null then
    insert into child_guardians (child_id, user_id, kindergarten_id) values (v_child, p_parent, v_kg);
    perform log_action(v_kg, 'guardian.link', 'child', v_child::text, jsonb_build_object('parent', p_parent));
  end if;

  update waitlist_applications
  set status = 'accepted', child_id = v_child, parent_user_id = p_parent,
      accepted_by = auth.uid(), accepted_at = now(), accepting_since = null, accepting_token = null
  where id = p_app;
  perform log_action(v_kg, 'waitlist.accept', 'waitlist_application', p_app::text,
    jsonb_build_object('child', v_child, 'name', a.child_name, 'parent', p_parent));
  return v_child;
end $$;

-- Step 4. Releases the claim when the accept failed — only the attempt that holds it.
create or replace function public.waitlist_abort_accept(p_app uuid, p_token uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update waitlist_applications set accepting_since = null, accepting_token = null
  where id = p_app and status <> 'accepted' and accepting_token = p_token and is_admin(kindergarten_id);
end $$;

revoke execute on function public.waitlist_begin_accept(uuid) from public, anon;
revoke execute on function public.waitlist_accept(uuid, uuid, text, date, uuid, date, numeric, uuid, boolean) from public, anon;
revoke execute on function public.waitlist_abort_accept(uuid, uuid) from public, anon;
grant execute on function public.waitlist_begin_accept(uuid) to authenticated, service_role;
grant execute on function public.waitlist_accept(uuid, uuid, text, date, uuid, date, numeric, uuid, boolean) to authenticated, service_role;
grant execute on function public.waitlist_abort_accept(uuid, uuid) to authenticated, service_role;

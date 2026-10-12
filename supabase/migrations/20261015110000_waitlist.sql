-- Stage 4B · Waitlist and the public application form (SPEC §5.11).
--
-- waitlist_applications — one row per application. Created either by an anonymous visitor through the public
--   form (the server validates, checks the honeypot and calls waitlist_public_submit() with the service role —
--   anonymous users get no table access at all) or manually by the administration (RLS insert, source = manual).
--   Status: new → contacted → accepted / declined. «accepted» is set only by waitlist_finish_accept(), together
--   with the created child (and parent), and is final.
-- waitlist_comments — comments of the administration plus automatic status-change entries (kind = status).
-- waitlist_rate_limits — submissions of the public form per IP hash / phone hash (service role only).
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
  desired_date date,
  comment text check (comment is null or length(comment) <= 1000),
  source text not null default 'manual' check (source in ('public', 'manual')),
  status text not null default 'new' check (status in ('new', 'contacted', 'accepted', 'declined')),
  status_changed_at timestamptz not null default now(),
  -- set together by waitlist_finish_accept()
  child_id uuid references public.children(id) on delete set null,
  parent_user_id uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  -- double-click guard of «Принять»: set while the server creates the child and the parent
  accepting_since timestamptz,
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
  ip_hash text not null,
  phone_hash text not null,
  created_at timestamptz not null default now()
);
create index waitlist_rate_limits_ip_idx on public.waitlist_rate_limits (ip_hash, created_at desc);
create index waitlist_rate_limits_phone_idx on public.waitlist_rate_limits (kindergarten_id, phone_hash, created_at desc);

-- ───────────────────────────── Integrity ─────────────────────────────
create or replace function public.tg_waitlist_application_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.child_id is not null and (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
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
-- Called by the server after zod validation and the honeypot check. Limits (window in the DB):
--   per IP hash   — p_ip_max submissions per hour (all gardens);
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
  p_ip_max int default 5,
  p_phone_max int default 3
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not kg_is_open(p_kg) then
    raise exception 'hs:notFound';
  end if;
  -- Serialise submissions of one IP so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('waitlist:' || p_ip_hash, 0));
  if (select count(*) from waitlist_rate_limits where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= p_ip_max
     or (select count(*) from waitlist_rate_limits
         where kindergarten_id = p_kg and phone_hash = p_phone_hash and created_at > now() - interval '24 hours') >= p_phone_max then
    raise exception 'hs:tooManyApplications';
  end if;
  insert into waitlist_rate_limits (kindergarten_id, ip_hash, phone_hash) values (p_kg, p_ip_hash, p_phone_hash);
  delete from waitlist_rate_limits where created_at < now() - interval '2 days';

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
revoke execute on function public.waitlist_public_submit(uuid, text, date, text, text, date, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.waitlist_public_submit(uuid, text, date, text, text, date, text, text, text, int, int) to service_role;

-- ───────────────────────────── «Принять» ─────────────────────────────
-- Step 1: claim the application (double-click / two admins guard). Returns
--   'ok'       — claimed, the caller now creates the child and the parent;
--   'accepted' — already accepted (the caller shows the existing child);
--   'busy'     — someone else is accepting it right now (the claim expires after 2 minutes).
create or replace function public.waitlist_begin_accept(p_app uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare
  a waitlist_applications;
begin
  select * into a from waitlist_applications where id = p_app for update;
  if a.id is null or not is_admin(a.kindergarten_id) then
    raise exception 'hs:notFound';
  end if;
  if a.status = 'accepted' then
    return 'accepted';
  end if;
  if a.accepting_since is not null and a.accepting_since > now() - interval '2 minutes' then
    return 'busy';
  end if;
  update waitlist_applications set accepting_since = now() where id = p_app;
  return 'ok';
end $$;

-- Step 2: link the created child (and parent), mark «Принята», write the audit entry.
create or replace function public.waitlist_finish_accept(p_app uuid, p_child uuid, p_parent uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  a waitlist_applications;
begin
  select * into a from waitlist_applications where id = p_app for update;
  if a.id is null or not is_admin(a.kindergarten_id) then
    raise exception 'hs:notFound';
  end if;
  if a.status = 'accepted' then
    raise exception 'hs:waitlistAccepted';
  end if;
  if (select kindergarten_id from children where id = p_child) is distinct from a.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if p_parent is not null and not exists (
    select 1 from child_guardians where child_id = p_child and user_id = p_parent
  ) then
    raise exception 'hs:invalid';
  end if;
  update waitlist_applications
  set status = 'accepted', child_id = p_child, parent_user_id = p_parent,
      accepted_by = auth.uid(), accepted_at = now(), accepting_since = null
  where id = p_app;
  perform log_action(a.kindergarten_id, 'waitlist.accept', 'waitlist_application', p_app::text,
    jsonb_build_object('child', p_child, 'name', a.child_name, 'parent', p_parent));
end $$;

-- Releases the claim when creating the child failed.
create or replace function public.waitlist_abort_accept(p_app uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update waitlist_applications set accepting_since = null
  where id = p_app and status <> 'accepted' and is_admin(kindergarten_id);
end $$;

revoke execute on function public.waitlist_begin_accept(uuid) from public, anon;
revoke execute on function public.waitlist_finish_accept(uuid, uuid, uuid) from public, anon;
revoke execute on function public.waitlist_abort_accept(uuid) from public, anon;
grant execute on function public.waitlist_begin_accept(uuid) to authenticated, service_role;
grant execute on function public.waitlist_finish_accept(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.waitlist_abort_accept(uuid) to authenticated, service_role;

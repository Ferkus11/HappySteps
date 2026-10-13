-- Stage 3A · Realtime chats (SPEC §5.7).
--
-- Chat kinds:
--   'group'  — one per group, created automatically. Members are COMPUTED from the source tables
--              (no copied list to keep in sync): owner(s) and head(s) of the garden, active teachers
--              assigned to the group, and active parents of active children currently in the group.
--              Transfers, archiving, unlinking a parent or a teacher take effect immediately.
--   'staff'  — one per garden, every active staff member (any role except parent).
--   'direct' — two people (user_a < user_b). Parent ↔ parent is impossible: a direct chat needs at
--              least one staff member, and a parent may START one only with a teacher of their child's
--              group, a head or an owner (start_direct_chat). Staff may start one with anyone of the garden.
-- Messages and attachments are never hard-deleted by the app (Realtime DELETE events are not
-- RLS-filtered): removal is a soft delete that also clears the text and soft-deletes the attachments
-- (their storage objects are removed by the server).
-- History: parents see a group chat from the day their child joined the group; authors may edit a
-- message for 15 minutes.

-- ───────────────────────────── Tables ─────────────────────────────
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  kind text not null check (kind in ('group', 'staff', 'direct')),
  group_id uuid references public.groups(id) on delete cascade,
  user_a uuid references public.profiles(id) on delete cascade,
  user_b uuid references public.profiles(id) on delete cascade,
  -- false = "только сотрудники пишут" (group chats only; parents read)
  parents_can_write boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'group') = (group_id is not null)),
  check ((kind = 'direct') = (user_a is not null and user_b is not null)),
  check (kind <> 'direct' or user_a < user_b)
);
create unique index chats_group_uidx on public.chats (group_id) where kind = 'group';
create unique index chats_staff_uidx on public.chats (kindergarten_id) where kind = 'staff';
create unique index chats_direct_uidx on public.chats (kindergarten_id, user_a, user_b) where kind = 'direct';
create index chats_kg_idx on public.chats (kindergarten_id, kind);
create index chats_user_a_idx on public.chats (user_a) where kind = 'direct';
create index chats_user_b_idx on public.chats (user_b) where kind = 'direct';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  body text not null default '' check (length(body) <= 4000),
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  check ((deleted_at is null) = (deleted_by is null))
);
create index messages_chat_idx on public.messages (chat_id, created_at desc);
create index messages_reply_idx on public.messages (reply_to) where reply_to is not null;

create table public.message_files (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  kind text not null check (kind in ('photo', 'pdf')),
  path text not null unique,
  -- objects live under <kindergarten>/<chat>/ — a row can never point at someone else's object
  check (path like kindergarten_id::text || '/' || chat_id::text || '/%'),
  name text not null check (length(name) between 1 and 200),
  mime text not null,
  size int not null check (size > 0 and size <= 15 * 1024 * 1024),
  created_at timestamptz not null default now(),
  -- soft delete (Realtime DELETE events are not RLS-filtered); the server removes the storage object
  deleted_at timestamptz
);
create index message_files_message_idx on public.message_files (message_id);
create index message_files_chat_idx on public.message_files (chat_id);

-- Read markers: one row per (chat, user), written only through mark_chat_read().
create table public.chat_reads (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index chat_reads_user_idx on public.chat_reads (user_id);

-- ───────────────────────────── Membership rules ─────────────────────────────
-- Internal helpers take an arbitrary user id → not executable by clients.

-- Active staff (any non-parent role) of the garden?
create or replace function public.chat_is_staff_uid(kg uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = uid and m.kindergarten_id = kg and m.status = 'active' and m.role <> 'parent')
$$;

create or replace function public.chat_has_role_uid(kg uuid, uid uuid, roles public.app_role[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = uid and m.kindergarten_id = kg and m.status = 'active' and m.role = any(roles))
$$;

-- Teaches (active teacher membership + assignment) the group?
create or replace function public.chat_teaches_uid(g uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_teachers gt
    join memberships m on m.user_id = gt.user_id and m.kindergarten_id = gt.kindergarten_id and m.role = 'teacher' and m.status = 'active'
    where gt.group_id = g and gt.user_id = uid)
$$;

-- Active parent of an active child currently in the group?
create or replace function public.chat_parent_in_group_uid(g uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from child_guardians cg
    join children c on c.id = cg.child_id and c.status = 'active' and c.group_id = g
    join memberships m on m.user_id = cg.user_id and m.kindergarten_id = cg.kindergarten_id and m.role = 'parent' and m.status = 'active'
    where cg.user_id = uid)
$$;

-- Is `uid` a member of the chat right now?
create or replace function public.chat_member(p_chat uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chats c
    where c.id = p_chat and uid is not null and public.kg_is_open(c.kindergarten_id)
      and case c.kind
        when 'staff' then public.chat_is_staff_uid(c.kindergarten_id, uid)
        when 'direct' then uid in (c.user_a, c.user_b)
          and exists (select 1 from memberships m where m.user_id = uid and m.kindergarten_id = c.kindergarten_id and m.status = 'active')
        when 'group' then public.chat_has_role_uid(c.kindergarten_id, uid, array['owner','head']::public.app_role[])
          or public.chat_teaches_uid(c.group_id, uid)
          or public.chat_parent_in_group_uid(c.group_id, uid)
        else false
      end)
$$;

-- Does `uid` take part on the staff side of this chat? (group: owner/head/teacher of the group;
-- staff chat: everyone; direct: any staff role). Used for read-only group chats and quiet hours.
create or replace function public.chat_staff_side(p_chat uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chats c
    where c.id = p_chat and case c.kind
      when 'group' then public.chat_has_role_uid(c.kindergarten_id, uid, array['owner','head']::public.app_role[])
        or public.chat_teaches_uid(c.group_id, uid)
      else public.chat_is_staff_uid(c.kindergarten_id, uid)
    end)
$$;

-- May `p_from` START a direct chat with `p_to`? Staff: anyone of the garden. Parent: teachers of
-- their children's current groups, heads, owners. Parent ↔ parent: never.
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
    )
$$;

-- May `uid` post into the chat?
create or replace function public.chat_can_write_uid(p_chat uuid, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chats c
    where c.id = p_chat and public.chat_member(c.id, uid)
      and case c.kind
        when 'group' then c.parents_can_write or public.chat_staff_side(c.id, uid)
        -- a direct chat needs a staff member on one side and both people still in the garden
        when 'direct' then (public.chat_is_staff_uid(c.kindergarten_id, c.user_a) or public.chat_is_staff_uid(c.kindergarten_id, c.user_b))
          and public.chat_member(c.id, case when uid = c.user_a then c.user_b else c.user_a end)
        else true
      end)
$$;

-- Since when has `uid` been a member of the chat? (start of unread counting; history limit for parents)
--   group:  owner/head — their membership; teacher — the teacher membership (group_teachers has no
--           timestamp of its own); parent — the day their child joined this group in the garden's time
--           zone (child_group_history.from_date of the child's current stay, else the guardian link).
--   staff:  their first staff membership.   direct: their first membership in the garden.
create or replace function public.chat_member_since(p_chat uuid, uid uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select coalesce(case c.kind
    when 'group' then least(
      (select min(m.created_at) from memberships m where m.user_id = uid and m.kindergarten_id = c.kindergarten_id
        and m.status = 'active' and m.role in ('owner', 'head')),
      (select min(m.created_at) from memberships m where m.user_id = uid and m.kindergarten_id = c.kindergarten_id
        and m.status = 'active' and m.role = 'teacher' and public.chat_teaches_uid(c.group_id, uid)),
      (select min(coalesce(
          (select h.from_date::timestamp at time zone coalesce((select ks.timezone from kindergarten_settings ks where ks.kindergarten_id = c.kindergarten_id), 'Asia/Almaty')
             from child_group_history h where h.child_id = ch.id and h.group_id = c.group_id and h.to_date is null
             order by h.from_date desc limit 1),
          cg.created_at))
        from child_guardians cg
        join children ch on ch.id = cg.child_id and ch.status = 'active' and ch.group_id = c.group_id
        join memberships m on m.user_id = cg.user_id and m.kindergarten_id = cg.kindergarten_id and m.role = 'parent' and m.status = 'active'
        where cg.user_id = uid))
    when 'staff' then (select min(m.created_at) from memberships m where m.user_id = uid and m.kindergarten_id = c.kindergarten_id
        and m.status = 'active' and m.role <> 'parent')
    else (select min(m.created_at) from memberships m where m.user_id = uid and m.kindergarten_id = c.kindergarten_id and m.status = 'active')
  end, now())
  from chats c where c.id = p_chat
$$;

-- Oldest message `uid` may read: parents (the parent side of a group chat) see the group's messages
-- from the day their child joined it; staff of the chat and other chat kinds see the whole history.
create or replace function public.chat_history_from(p_chat uuid, uid uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select case when c.kind = 'group' and not public.chat_staff_side(c.id, uid)
              then public.chat_member_since(c.id, uid) else '-infinity'::timestamptz end
  from chats c where c.id = p_chat
$$;

revoke execute on function public.chat_is_staff_uid(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_has_role_uid(uuid, uuid, public.app_role[]) from public, anon, authenticated;
revoke execute on function public.chat_teaches_uid(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_parent_in_group_uid(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_staff_side(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_may_start(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_can_write_uid(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_member_since(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_history_from(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_member(uuid, uuid) to service_role;
grant execute on function public.chat_can_write_uid(uuid, uuid) to service_role;

-- The same rules for the current user (safe for clients: they only answer about themselves).
create or replace function public.can_access_chat(p_chat uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.chat_member(p_chat, auth.uid())
$$;
create or replace function public.can_write_chat(p_chat uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.chat_can_write_uid(p_chat, auth.uid())
$$;
-- Oldest readable message time for the current user (used by messages/message_files RLS).
create or replace function public.chat_visible_from(p_chat uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select public.chat_history_from(p_chat, auth.uid())
$$;
revoke execute on function public.chat_visible_from(uuid) from public, anon;
grant execute on function public.chat_visible_from(uuid) to authenticated, service_role;
revoke execute on function public.can_access_chat(uuid) from public, anon;
revoke execute on function public.can_write_chat(uuid) from public, anon;
grant execute on function public.can_access_chat(uuid) to authenticated, service_role;
grant execute on function public.can_write_chat(uuid) to authenticated, service_role;

-- Current members of a chat (for notifications; service role only).
create or replace function public.chat_member_ids(p_chat uuid) returns setof uuid
  language sql stable security definer set search_path = public as $$
  select distinct m.user_id from chats c
  join memberships m on m.kindergarten_id = c.kindergarten_id and m.status = 'active'
  where c.id = p_chat and public.chat_member(c.id, m.user_id)
$$;
revoke execute on function public.chat_member_ids(uuid) from public, anon, authenticated;
grant execute on function public.chat_member_ids(uuid) to service_role;

-- ───────────────────────────── Quiet hours (SPEC §5.7) ─────────────────────────────
-- Push delivery of a bell notification may be deferred (stage 6 sends a push only once
-- `deliver_after` has passed). The in-app row exists at once, so nothing is lost.
alter table public.notifications add column if not exists deliver_after timestamptz;

-- Internal: is local time of `at` inside [start, end) in the garden's time zone? Handles the overnight window.
create or replace function public.chat_quiet_at(kg uuid, p_at timestamptz) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when s.quiet_hours_start = s.quiet_hours_end then false
    when s.quiet_hours_start < s.quiet_hours_end then t >= s.quiet_hours_start and t < s.quiet_hours_end
    else t >= s.quiet_hours_start or t < s.quiet_hours_end
  end
  from (select coalesce(ks.quiet_hours_start, '21:00'::time) as quiet_hours_start, coalesce(ks.quiet_hours_end, '08:00'::time) as quiet_hours_end,
               (p_at at time zone coalesce(ks.timezone, 'Asia/Almaty'))::time as t
        from (select 1) one left join kindergarten_settings ks on ks.kindergarten_id = kg) s
$$;

-- Internal: the moment the current quiet period ends (next local `quiet_hours_end` after `at`),
-- or null when `at` is outside quiet hours.
create or replace function public.chat_quiet_ends(kg uuid, p_at timestamptz) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select case when public.chat_quiet_at(kg, p_at) then
      (case when s.loc::date + s.qe > s.loc then s.loc::date + s.qe else (s.loc::date + 1) + s.qe end) at time zone s.tz
    end
  from (select coalesce(ks.quiet_hours_end, '08:00'::time) as qe, coalesce(ks.timezone, 'Asia/Almaty') as tz,
               p_at at time zone coalesce(ks.timezone, 'Asia/Almaty') as loc
        from (select 1) one left join kindergarten_settings ks on ks.kindergarten_id = kg) s
$$;
revoke execute on function public.chat_quiet_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.chat_quiet_ends(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_quiet_ends(uuid, timestamptz) to service_role;

-- Public answer, only for members of that garden (and the server).
create or replace function public.kg_in_quiet_hours(kg uuid, p_at timestamptz default now()) returns boolean
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member(kg) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.chat_quiet_at(kg, p_at);
end $$;
revoke execute on function public.kg_in_quiet_hours(uuid, timestamptz) from public, anon;
grant execute on function public.kg_in_quiet_hours(uuid, timestamptz) to authenticated, service_role;

-- Should push delivery of a "new message" notification from `p_author` to `p_recipient` wait for the
-- morning? Only messages written from the parent side to staff during quiet hours.
create or replace function public.chat_quiet_suppressed(p_chat uuid, p_author uuid, p_recipient uuid, p_at timestamptz default now()) returns boolean
  language sql stable security definer set search_path = public as $$
  select not public.chat_staff_side(p_chat, p_author)
     and public.chat_staff_side(p_chat, p_recipient)
     and public.chat_quiet_at((select kindergarten_id from chats where id = p_chat), p_at)
$$;
revoke execute on function public.chat_quiet_suppressed(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_quiet_suppressed(uuid, uuid, uuid, timestamptz) to service_role;

-- Who gets an in-app notification about a new message (service role only):
-- other current members, minus people who looked at the chat in the last minute (they are reading it),
-- minus people who already have an unread notification for this chat (one per chat, no spam).
-- `deliver_after`: staff receiving a message from the parent side during quiet hours still get the bell
-- row at once, but its push waits until the quiet hours end (garden time zone).
create or replace function public.chat_notify_targets(p_chat uuid, p_author uuid)
  returns table (user_id uuid, deliver_after timestamptz)
  language sql stable security definer set search_path = public as $$
  select u, case when public.chat_quiet_suppressed(p_chat, p_author, u, now())
                 then public.chat_quiet_ends((select kindergarten_id from chats where id = p_chat), now()) end
  from public.chat_member_ids(p_chat) u
  where u is distinct from p_author
    and not exists (select 1 from chat_reads r where r.chat_id = p_chat and r.user_id = u and r.last_read_at > now() - interval '1 minute')
    and not exists (select 1 from notifications n where n.user_id = u and n.type = 'message.new' and n.url = '/chats/' || p_chat::text and n.read_at is null)
$$;
revoke execute on function public.chat_notify_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_notify_targets(uuid, uuid) to service_role;

-- ───────────────────────────── Automatic chats ─────────────────────────────
create or replace function public.tg_group_chat() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into chats (kindergarten_id, kind, group_id) values (new.kindergarten_id, 'group', new.id)
  on conflict do nothing;
  return new;
end $$;
create trigger groups_chat after insert on public.groups for each row execute function public.tg_group_chat();

create or replace function public.tg_staff_chat() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into chats (kindergarten_id, kind) values (new.id, 'staff') on conflict do nothing;
  return new;
end $$;
create trigger kindergartens_staff_chat after insert on public.kindergartens for each row execute function public.tg_staff_chat();

insert into public.chats (kindergarten_id, kind, group_id)
  select g.kindergarten_id, 'group', g.id from public.groups g on conflict do nothing;
insert into public.chats (kindergarten_id, kind)
  select k.id, 'staff' from public.kindergartens k on conflict do nothing;

-- ───────────────────────────── Integrity triggers ─────────────────────────────
create or replace function public.tg_chat_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.kindergarten_id <> old.kindergarten_id or new.kind <> old.kind
     or new.group_id is distinct from old.group_id or new.user_a is distinct from old.user_a or new.user_b is distinct from old.user_b) then
    raise exception 'kindergarten is immutable' using errcode = '42501';
  end if;
  if new.group_id is not null and (select kindergarten_id from groups where id = new.group_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if new.kind <> 'group' then new.parents_can_write := true; end if;
  return new;
end $$;
create trigger chats_guard before insert or update on public.chats for each row execute function public.tg_chat_guard();

-- Messages: garden from the chat, reply only within the same chat, server-side timestamps for clients.
create or replace function public.tg_message_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare kg uuid;
begin
  if tg_op = 'INSERT' then
    select kindergarten_id into kg from chats where id = new.chat_id;
    if kg is distinct from new.kindergarten_id then
      raise exception 'kindergarten mismatch' using errcode = '42501';
    end if;
    if new.reply_to is not null and (select chat_id from messages where id = new.reply_to) is distinct from new.chat_id then
      raise exception 'hs:invalid';
    end if;
    -- a reply cannot quote a message the author is not allowed to read
    if new.reply_to is not null and auth.uid() is not null
       and (select created_at from messages where id = new.reply_to) < public.chat_history_from(new.chat_id, auth.uid()) then
      raise exception 'hs:invalid';
    end if;
    if auth.uid() is not null then
      new.created_at := now();
      new.edited_at := null;
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
  else
    if new.chat_id <> old.chat_id or new.kindergarten_id <> old.kindergarten_id or new.author_id is distinct from old.author_id
       or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to then
      raise exception 'kindergarten is immutable' using errcode = '42501';
    end if;
    if new.body is distinct from old.body and new.deleted_at is null then
      if length(trim(new.body)) = 0 then raise exception 'hs:invalid'; end if;
      -- authors may fix a message only within 15 minutes of sending it
      if auth.uid() is not null and old.created_at < now() - interval '15 minutes' then
        raise exception 'hs:editExpired';
      end if;
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger messages_guard before insert or update on public.messages for each row execute function public.tg_message_guard();

create or replace function public.tg_message_file_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select chat_id from messages where id = new.message_id) is distinct from new.chat_id
     or (select kindergarten_id from chats where id = new.chat_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger message_files_guard before insert or update on public.message_files for each row execute function public.tg_message_file_guard();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.message_files enable row level security;
alter table public.chat_reads enable row level security;

create policy chats_select on public.chats for select to authenticated using (public.can_access_chat(id));
-- Chats are created by triggers (group/staff) and start_direct_chat(); the only client change is the
-- "только сотрудники пишут" switch of a group chat by owner/head.
revoke insert, update, delete on public.chats from authenticated;
grant update (parents_can_write) on public.chats to authenticated;
create policy chats_update on public.chats for update to authenticated
  using (kind = 'group' and public.is_admin(kindergarten_id))
  with check (kind = 'group' and public.is_admin(kindergarten_id));

-- Parents see a group chat's messages from the day their child joined the group.
create policy messages_select on public.messages for select to authenticated
  using (public.can_access_chat(chat_id) and created_at >= public.chat_visible_from(chat_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_write_chat(chat_id));
revoke insert, update, delete on public.messages from authenticated;
grant insert (id, kindergarten_id, chat_id, author_id, body, reply_to) on public.messages to authenticated;
-- Authors edit the text of their own live messages; deletion goes through delete_chat_message().
grant update (body) on public.messages to authenticated;
create policy messages_update on public.messages for update to authenticated
  using (author_id = auth.uid() and deleted_at is null and public.can_write_chat(chat_id))
  with check (author_id = auth.uid() and deleted_at is null and public.can_write_chat(chat_id));

-- Live attachments of messages the user may read (the message subquery applies messages RLS).
create policy message_files_select on public.message_files for select to authenticated
  using (deleted_at is null and public.can_access_chat(chat_id) and exists (select 1 from messages x where x.id = message_id));
-- rows are written by the send action with the service role, after its own permission check
revoke insert, update, delete on public.message_files from authenticated;

-- Own read markers; in a direct chat also the other person's (for «прочитано»).
create policy chat_reads_select on public.chat_reads for select to authenticated using (
  (user_id = auth.uid() and public.is_member(kindergarten_id))
  or (public.can_access_chat(chat_id) and exists (select 1 from chats c where c.id = chat_id and c.kind = 'direct'))
);
revoke insert, update, delete on public.chat_reads from authenticated;

-- ───────────────────────────── Functions for the app ─────────────────────────────
-- Returns the direct chat with `p_other` (creating it when allowed). Parent ↔ parent is rejected.
create or replace function public.start_direct_chat(p_kg uuid, p_other uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare a uuid; b uuid; cid uuid;
begin
  if not public.chat_may_start(p_kg, auth.uid(), p_other) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  a := least(auth.uid(), p_other);
  b := greatest(auth.uid(), p_other);
  select id into cid from chats where kindergarten_id = p_kg and kind = 'direct' and user_a = a and user_b = b;
  if cid is null then
    insert into chats (kindergarten_id, kind, user_a, user_b, created_by) values (p_kg, 'direct', a, b, auth.uid())
    on conflict do nothing returning id into cid;
    if cid is null then
      select id into cid from chats where kindergarten_id = p_kg and kind = 'direct' and user_a = a and user_b = b;
    end if;
  end if;
  return cid;
end $$;
revoke execute on function public.start_direct_chat(uuid, uuid) from public, anon;
grant execute on function public.start_direct_chat(uuid, uuid) to authenticated;

-- Marks the chat read for the current user (and clears the chat's unread bell notifications).
create or replace function public.mark_chat_read(p_chat uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare kg uuid;
begin
  if not public.can_access_chat(p_chat) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select kindergarten_id into kg from chats where id = p_chat;
  insert into chat_reads (chat_id, user_id, kindergarten_id, last_read_at) values (p_chat, auth.uid(), kg, now())
  on conflict (chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  update notifications set read_at = now()
  where user_id = auth.uid() and type = 'message.new' and url = '/chats/' || p_chat::text and read_at is null;
end $$;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Soft delete: the author (any chat) or owner/head (group chats — moderation, audited).
-- Clears the text and soft-deletes the attachment rows; returns the storage paths for the caller to remove.
create or replace function public.delete_chat_message(p_id uuid) returns setof text
  language plpgsql security definer set search_path = public as $$
declare m messages; c chats; moderated boolean;
begin
  select * into m from messages where id = p_id for update;
  if m.id is null or not public.can_access_chat(m.chat_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from chats where id = m.chat_id;
  if m.author_id = auth.uid() then
    moderated := false;
  elsif c.kind = 'group' and public.is_admin(c.kindergarten_id) then
    moderated := true;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if m.deleted_at is not null then return; end if;
  update messages set deleted_at = now(), deleted_by = auth.uid(), body = '' where id = p_id;
  -- The bell keeps no copy of a removed message: its text is dropped («Сообщение удалено») and a push that has
  -- not gone out yet (quiet hours) is marked handled so the cron never sends it.
  update notifications set params = (params - 'text') || jsonb_build_object('deleted', 'yes'), pushed_at = coalesce(pushed_at, now())
  where type = 'message.new' and params->>'message_id' = p_id::text;
  if moderated then
    perform public.log_action(c.kindergarten_id, 'chat.message_delete', 'message', p_id::text,
      jsonb_build_object('chat_id', c.id, 'group_id', c.group_id, 'author_id', m.author_id, 'text', left(m.body, 200)));
  end if;
  return query update message_files set deleted_at = now() where message_id = p_id and deleted_at is null returning path;
end $$;
revoke execute on function public.delete_chat_message(uuid) from public, anon;
grant execute on function public.delete_chat_message(uuid) to authenticated;

-- Chats of the current user in a garden with the last message and the unread count.
-- Unread = live messages from others after the user's read marker and after the user joined the chat
-- (chat_member_since: a parent from the day the child joined the group, a teacher from their teacher
-- membership). The last message honours the parents' history limit.
create or replace function public.chat_list(p_kg uuid)
  returns table (
    id uuid, kind text, group_id uuid, group_name text, group_color text, group_sort int,
    other_id uuid, other_name text, other_role text,
    parents_can_write boolean, can_write boolean,
    last_id uuid, last_body text, last_author_id uuid, last_author_name text, last_at timestamptz,
    last_deleted boolean, last_file text, unread int, created_at timestamptz)
  language sql stable security definer set search_path = public as $$
  with base as (
    select c.*, auth.uid() as uid,
      greatest((select r.last_read_at from chat_reads r where r.chat_id = c.id and r.user_id = auth.uid()),
               public.chat_member_since(c.id, auth.uid())) as read_from,
      public.chat_history_from(c.id, auth.uid()) as visible_from
    from chats c
    where c.kindergarten_id = p_kg and public.is_member(p_kg)
      and (c.kind <> 'direct' or auth.uid() in (c.user_a, c.user_b))
      and public.chat_member(c.id, auth.uid())
  )
  select b.id, b.kind, b.group_id, g.name, g.color, g.sort_order,
    o.id, o.full_name,
    (select m.role::text from memberships m where m.user_id = o.id and m.kindergarten_id = p_kg and m.status = 'active'
      order by array_position(array['owner','head','teacher','accountant','club_teacher','cook','parent'], m.role::text) limit 1),
    b.parents_can_write, public.chat_can_write_uid(b.id, b.uid),
    l.id, l.body, l.author_id, ap.full_name, l.created_at, l.deleted_at is not null,
    (select f.kind from message_files f where f.message_id = l.id and f.deleted_at is null order by f.created_at limit 1),
    (select count(*)::int from messages x
      where x.chat_id = b.id and x.deleted_at is null and x.author_id is distinct from b.uid
        and x.created_at > b.read_from and x.created_at >= b.visible_from),
    b.created_at
  from base b
  left join groups g on g.id = b.group_id
  left join profiles o on b.kind = 'direct' and o.id = case when b.user_a = b.uid then b.user_b else b.user_a end
  left join lateral (select * from messages x where x.chat_id = b.id and x.created_at >= b.visible_from order by x.created_at desc limit 1) l on true
  left join profiles ap on ap.id = l.author_id
$$;
revoke execute on function public.chat_list(uuid) from public, anon;
grant execute on function public.chat_list(uuid) to authenticated;

-- Total unread messages of the current user in a garden (header badge).
create or replace function public.chat_unread_total(p_kg uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread), 0)::int from public.chat_list(p_kg)
$$;
revoke execute on function public.chat_unread_total(uuid) from public, anon;
grant execute on function public.chat_unread_total(uuid) to authenticated;

-- People of a chat the caller can access: current members plus past authors (names for messages),
-- with the role they have in this chat. Lets parents see the names of other parents of the group
-- only inside the group chat (profiles RLS hides them elsewhere).
create or replace function public.chat_participants(p_chat uuid)
  returns table (user_id uuid, full_name text, chat_role text, is_member boolean)
  language sql stable security definer set search_path = public as $$
  with c as (select * from chats where id = p_chat and public.can_access_chat(p_chat)),
  ids as (
    select u as uid from c, public.chat_member_ids(c.id) u
    union
    select distinct x.author_id from c join messages x on x.chat_id = c.id
    where x.author_id is not null and x.created_at >= public.chat_visible_from(c.id)
  )
  select p.id, p.full_name,
    case
      when c.kind = 'group' and public.chat_has_role_uid(c.kindergarten_id, p.id, array['owner']::public.app_role[]) then 'owner'
      when c.kind = 'group' and public.chat_has_role_uid(c.kindergarten_id, p.id, array['head']::public.app_role[]) then 'head'
      when c.kind = 'group' and public.chat_teaches_uid(c.group_id, p.id) then 'teacher'
      when c.kind = 'group' and public.chat_parent_in_group_uid(c.group_id, p.id) then 'parent'
      when c.kind = 'group' then null
      else (select m.role::text from memberships m where m.user_id = p.id and m.kindergarten_id = c.kindergarten_id and m.status = 'active'
            order by array_position(array['owner','head','teacher','accountant','club_teacher','cook','parent'], m.role::text) limit 1)
    end,
    public.chat_member(c.id, p.id)
  from c cross join ids join profiles p on p.id = ids.uid
  order by 4 desc, 2
$$;
revoke execute on function public.chat_participants(uuid) from public, anon;
grant execute on function public.chat_participants(uuid) to authenticated;

-- People the current user may start a direct chat with (the "Новый чат" picker).
-- `hint`: group names for teachers, names of visible children for parents.
create or replace function public.chat_contacts(p_kg uuid)
  returns table (user_id uuid, full_name text, role text, hint text)
  language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, r.role,
    case
      when r.role = 'teacher' then (select string_agg(g.name, ', ' order by g.sort_order, g.name) from group_teachers gt join groups g on g.id = gt.group_id where gt.user_id = p.id and gt.kindergarten_id = p_kg)
      when r.role = 'parent' then (select string_agg(split_part(ch.full_name, ' ', 2), ', ' order by ch.full_name) from child_guardians cg join children ch on ch.id = cg.child_id
                                   where cg.user_id = p.id and cg.kindergarten_id = p_kg and ch.status = 'active' and public.child_visible(ch.id))
    end
  from profiles p
  cross join lateral (
    select m.role::text as role from memberships m where m.user_id = p.id and m.kindergarten_id = p_kg and m.status = 'active'
    order by array_position(array['owner','head','teacher','accountant','club_teacher','cook','parent'], m.role::text) limit 1) r
  where public.is_member(p_kg) and public.chat_may_start(p_kg, auth.uid(), p.id)
  order by array_position(array['owner','head','teacher','accountant','club_teacher','cook','parent'], r.role), p.full_name
$$;
revoke execute on function public.chat_contacts(uuid) from public, anon;
grant execute on function public.chat_contacts(uuid) to authenticated;

-- ───────────────────────────── Realtime & storage ─────────────────────────────
alter publication supabase_realtime add table public.messages, public.message_files, public.chat_reads, public.chats;

-- Private bucket; only the server (service role) touches it after its own checks, reads via signed URLs.
insert into storage.buckets (id, name, public) values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;

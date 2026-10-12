-- Stage 3B: children's and staff documents (SPEC §5.8, §3.4, §11).
--
-- child_documents            files in a child's folder (4 categories, no statuses)
-- staff_documents            employee documents with an optional expiry date
-- staff_document_reminders   bookkeeping for the expiry cron (30 / 7 days, once per document and expiry date)
--
-- Files live in the private buckets `child-documents` / `staff-documents` under
-- `<kindergarten>/<child|user>/<uuid>.<ext>`. Rows are inserted ONLY by the server (service role)
-- after its own permission checks (the same rules as below); clients can read and delete.

-- ───────────────────────────── Tables ─────────────────────────────
create table public.child_documents (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  category text not null check (category in ('medical', 'vaccination', 'applications', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  path text not null unique,
  -- a row can never point at another garden's or another child's object
  check (path ~ ('^' || kindergarten_id::text || '/' || child_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size int not null check (size > 0 and size <= 15 * 1024 * 1024),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index child_documents_child_idx on public.child_documents (child_id, category, created_at desc);
create index child_documents_kg_idx on public.child_documents (kindergarten_id);

create table public.staff_documents (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('med_book', 'no_criminal_record', 'contract', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  expires_on date,
  path text not null unique,
  check (path ~ ('^' || kindergarten_id::text || '/' || user_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size int not null check (size > 0 and size <= 15 * 1024 * 1024),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index staff_documents_user_idx on public.staff_documents (kindergarten_id, user_id, created_at desc);
create index staff_documents_expiry_idx on public.staff_documents (kindergarten_id, expires_on) where expires_on is not null;

create table public.staff_document_reminders (
  document_id uuid not null references public.staff_documents(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  expires_on date not null, -- the expiry the reminder was sent for (a new date re-arms the reminders)
  threshold smallint not null check (threshold in (30, 7)),
  sent_at timestamptz not null default now(),
  primary key (document_id, expires_on, threshold)
);

-- ───────────────────────────── Same-garden triggers ─────────────────────────────
create or replace function public.tg_same_kg_child_document() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger child_documents_same_kg before insert or update on public.child_documents
  for each row execute function public.tg_same_kg_child_document();

-- The owner of a staff document must be an employee (non-parent membership) of the same garden.
create or replace function public.tg_same_kg_staff_document() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships m where m.user_id = new.user_id and m.kindergarten_id = new.kindergarten_id and m.role <> 'parent') then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_documents_same_kg before insert or update on public.staff_documents
  for each row execute function public.tg_same_kg_staff_document();

create or replace function public.tg_same_kg_staff_document_reminder() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from staff_documents where id = new.document_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_document_reminders_same_kg before insert or update on public.staff_document_reminders
  for each row execute function public.tg_same_kg_staff_document_reminder();

-- ───────────────────────────── Access helpers ─────────────────────────────
-- Child folder (§3.4): owner/head, the child's parents, the teacher of the child's group (view only).
-- Accountant, cook and club teacher: no access.
create or replace function public.child_docs_can_view(c uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_admin((select kindergarten_id from children where id = c))
      or public.is_guardian(c)
      or public.teaches_child(c)
$$;

-- Upload: the child's parents and owner/head.
create or replace function public.child_docs_can_upload(c uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_admin((select kindergarten_id from children where id = c))
      or public.is_guardian(c)
$$;

-- Staff documents (§3.4): owner/head/accountant see everybody's, each employee sees own.
create or replace function public.staff_docs_can_view(kg uuid, u uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner','head','accountant']::public.app_role[])
      or (u = auth.uid() and public.is_staff(kg))
$$;

-- Upload: the employee themself or owner/head; the target must be an active employee of the garden.
create or replace function public.staff_docs_can_upload(kg uuid, u uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select (public.is_admin(kg) or (u = auth.uid() and public.is_staff(kg)))
     and exists (select 1 from memberships m where m.user_id = u and m.kindergarten_id = kg and m.status = 'active' and m.role <> 'parent')
$$;

revoke execute on function public.child_docs_can_view(uuid) from public, anon;
revoke execute on function public.child_docs_can_upload(uuid) from public, anon;
revoke execute on function public.staff_docs_can_view(uuid, uuid) from public, anon;
revoke execute on function public.staff_docs_can_upload(uuid, uuid) from public, anon;
grant execute on function public.child_docs_can_view(uuid) to authenticated;
grant execute on function public.child_docs_can_upload(uuid) to authenticated;
grant execute on function public.staff_docs_can_view(uuid, uuid) to authenticated;
grant execute on function public.staff_docs_can_upload(uuid, uuid) to authenticated;

-- ───────────────────────────── Expiry reminders (cron) ─────────────────────────────
-- Staff documents due a reminder now: expiry date set, 8–30 days left → threshold 30, 0–7 days left →
-- threshold 7 ("today" in the garden's time zone), the employee is still active staff, the garden is open,
-- and that threshold was not sent yet for this expiry date. A document uploaded with ≤7 days left gets only
-- the 7-day reminder; expired documents get none (the dashboard shows them).
create or replace function public.document_expiry_due(p_now timestamptz default now())
  returns table (kindergarten_id uuid, document_id uuid, user_id uuid, person text, title text, doc_type text,
                 expires_on date, threshold int, days_left int)
  language sql stable security definer set search_path = public as $$
  with docs as (
    select d.id, d.kindergarten_id as kg, d.user_id as uid, d.title as doc_title, d.type as dtype, d.expires_on as exp,
           d.expires_on - (p_now at time zone coalesce(s.timezone, 'Asia/Almaty'))::date as left_days
    from staff_documents d
    left join kindergarten_settings s on s.kindergarten_id = d.kindergarten_id
    where d.expires_on is not null
      and public.kg_is_open(d.kindergarten_id)
      and exists (select 1 from memberships m where m.user_id = d.user_id and m.kindergarten_id = d.kindergarten_id
                  and m.status = 'active' and m.role <> 'parent')
  ), due as (
    select docs.*, case when left_days between 0 and 7 then 7 when left_days between 8 and 30 then 30 end as th
    from docs
  )
  select due.kg, due.id, due.uid, p.full_name, due.doc_title, due.dtype, due.exp, due.th, due.left_days
  from due
  join profiles p on p.id = due.uid
  where due.th is not null
    and not exists (select 1 from staff_document_reminders r
                    where r.document_id = due.id and r.expires_on = due.exp and r.threshold = due.th)
  order by due.kg, due.exp, due.id
$$;
revoke execute on function public.document_expiry_due(timestamptz) from public, anon, authenticated;
grant execute on function public.document_expiry_due(timestamptz) to service_role;

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.child_documents enable row level security;
alter table public.staff_documents enable row level security;
alter table public.staff_document_reminders enable row level security;

create policy child_documents_select on public.child_documents for select to authenticated
  using (public.child_docs_can_view(child_id));
-- Rows are inserted by the upload action with the service role, after its own permission check.
revoke insert, update on public.child_documents from authenticated, anon;
-- Delete: owner/head any; a parent only what they uploaded themselves.
create policy child_documents_delete on public.child_documents for delete to authenticated using (
  public.is_admin(kindergarten_id)
  or (uploaded_by = auth.uid() and public.child_docs_can_upload(child_id))
);

create policy staff_documents_select on public.staff_documents for select to authenticated
  using (public.staff_docs_can_view(kindergarten_id, user_id));
revoke insert, update on public.staff_documents from authenticated, anon;
-- Delete: owner/head any; an employee only own documents they uploaded themselves.
create policy staff_documents_delete on public.staff_documents for delete to authenticated using (
  public.is_admin(kindergarten_id)
  or (uploaded_by = auth.uid() and user_id = auth.uid() and public.is_staff(kindergarten_id))
);

-- staff_document_reminders: no policies → service role only.
revoke insert, update, delete on public.staff_document_reminders from authenticated, anon;

-- ───────────────────────────── Storage ─────────────────────────────
-- Private buckets; only the server (service role) touches them, reads go through short signed URLs.
insert into storage.buckets (id, name, public) values
  ('child-documents', 'child-documents', false),
  ('staff-documents', 'staff-documents', false)
on conflict (id) do nothing;

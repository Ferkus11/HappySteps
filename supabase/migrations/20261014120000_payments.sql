-- Stage 3C · Kindergarten fees: monthly invoices and payment receipts (SPEC §5.9).
--
-- Balance model ("monthly statement"): every child has at most one invoice per month (period = 1st day).
--   carried     — opening balance = closing balance of the child's previous invoice
--                 (> 0: debt carried over, < 0: advance from an overpayment, 0 for the first invoice)
--   amount      — this month's charge (amount_original = monthly_fee at accrual; changed only by adjust_invoice)
--   paid_amount — sum of confirmed amounts of the accepted receipts attached to this invoice
--   balance     — closing balance = carried + amount − paid_amount (generated). The child's current balance is
--                 the balance of the latest invoice; it is carried into the next month's invoice.
--   status      — review (a receipt is pending) / paid (balance ≤ 0) / partial (something paid, balance > 0) /
--                 rejected (last reviewed receipt was rejected, nothing paid) / unpaid.
--                 "Просрочен" is computed in the app: latest invoice, balance > 0, not in review, today > due_date.
-- carried / paid_amount / status / paid_at are derived and recomputed by invoices_recalc(child) whenever a receipt
-- or an amount changes, so a late confirmation of an older invoice cascades into the following months.
-- Nobody writes these tables directly: accrual, adjustment and review go through the functions below
-- (role checks + audit inside SQL); receipt rows are inserted by the server (service role) after its checks.

-- ───────────────────────────── Tables ─────────────────────────────
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  -- no cascade: a child with invoices cannot be hard-deleted (debts stay visible in finance, SPEC §5.9)
  child_id uuid not null references public.children(id),
  period date not null check (extract(day from period) = 1),
  amount_original numeric(12, 2) not null check (amount_original >= 0),
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 100000000),
  adjustment_comment text check (adjustment_comment is null or length(adjustment_comment) <= 500),
  adjusted_by uuid references public.profiles(id) on delete set null,
  adjusted_at timestamptz,
  due_date date not null,
  carried numeric(12, 2) not null default 0,
  paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
  balance numeric(12, 2) generated always as (carried + amount - paid_amount) stored,
  status text not null default 'unpaid' check (status in ('unpaid', 'review', 'paid', 'partial', 'rejected')),
  paid_at timestamptz, -- when the invoice became fully paid (analytics: days from the 1st to payment)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, period)
);
create index invoices_kg_period_idx on public.invoices (kindergarten_id, period);
create index invoices_kg_status_idx on public.invoices (kindergarten_id, status);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  child_id uuid not null references public.children(id),
  uploaded_by uuid references public.profiles(id) on delete set null,
  file_path text not null unique,
  -- files live under <kindergarten>/<child>/ — a row can never point at someone else's object
  check (file_path like kindergarten_id::text || '/' || child_id::text || '/%'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size int not null check (size > 0 and size <= 15 * 1024 * 1024),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  confirmed_amount numeric(12, 2) check (confirmed_amount is null or (confirmed_amount > 0 and confirmed_amount <= 100000000)),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'accepted') = (confirmed_amount is not null)),
  check (status <> 'rejected' or length(trim(coalesce(reject_reason, ''))) >= 3),
  check ((status = 'pending') = (reviewed_at is null))
);
create index payment_receipts_invoice_idx on public.payment_receipts (invoice_id, created_at);
create index payment_receipts_kg_status_idx on public.payment_receipts (kindergarten_id, status, created_at);

-- ───────────────────────────── Integrity ─────────────────────────────
create or replace function public.tg_invoice_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from children where id = new.child_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.kindergarten_id <> old.kindergarten_id or new.child_id <> old.child_id or new.period <> old.period then
      raise exception 'invoice identity is immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function public.tg_invoice_guard();

create or replace function public.tg_receipt_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  select * into inv from invoices where id = new.invoice_id;
  if inv.id is null or inv.kindergarten_id is distinct from new.kindergarten_id or inv.child_id is distinct from new.child_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.file_path <> old.file_path or new.kindergarten_id <> old.kindergarten_id) then
    raise exception 'receipt identity is immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.status = 'pending'
     and (select count(*) from payment_receipts where invoice_id = new.invoice_id and status = 'pending') >= 5 then
    raise exception 'hs:tooManyReceipts';
  end if;
  return new;
end $$;
create trigger payment_receipts_guard before insert or update on public.payment_receipts
  for each row execute function public.tg_receipt_guard();

-- Recomputes carried / paid_amount / status / paid_at of all invoices of a child, oldest first.
create or replace function public.invoices_recalc(p_child uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  r invoices;
  running numeric(12, 2) := 0;
  v_paid numeric(12, 2);
  v_pending boolean;
  v_last text;
  v_paid_at timestamptz;
  v_bal numeric(12, 2);
  v_status text;
begin
  for r in select * from invoices where child_id = p_child order by period for update loop
    select coalesce(sum(confirmed_amount) filter (where status = 'accepted'), 0),
           coalesce(bool_or(status = 'pending'), false),
           max(reviewed_at) filter (where status = 'accepted')
      into v_paid, v_pending, v_paid_at
      from payment_receipts where invoice_id = r.id;
    select status into v_last from payment_receipts
      where invoice_id = r.id and status <> 'pending' order by reviewed_at desc limit 1;
    v_bal := running + r.amount - v_paid;
    v_status := case
      when v_pending then 'review'
      when v_bal <= 0 then 'paid'
      when v_paid > 0 then 'partial'
      when v_last = 'rejected' then 'rejected'
      else 'unpaid' end;
    if r.carried is distinct from running or r.paid_amount is distinct from v_paid or r.status is distinct from v_status
       or (v_bal <= 0) is distinct from (r.paid_at is not null) then
      update invoices set
        carried = running,
        paid_amount = v_paid,
        status = v_status,
        paid_at = case when v_bal <= 0 then coalesce(r.paid_at, v_paid_at, now()) end
      where id = r.id;
    end if;
    running := v_bal;
  end loop;
end $$;
revoke execute on function public.invoices_recalc(uuid) from public, anon, authenticated;

create or replace function public.tg_invoices_recalc() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'payment_receipts' and tg_op = 'DELETE' then
    perform public.invoices_recalc(old.child_id);
    return old;
  end if;
  perform public.invoices_recalc(new.child_id);
  return new;
end $$;
create trigger invoices_after_insert after insert on public.invoices
  for each row execute function public.tg_invoices_recalc();
create trigger invoices_after_amount after update of amount on public.invoices
  for each row when (new.amount is distinct from old.amount) execute function public.tg_invoices_recalc();
create trigger payment_receipts_recalc after insert or update or delete on public.payment_receipts
  for each row execute function public.tg_invoices_recalc();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.invoices enable row level security;
alter table public.payment_receipts enable row level security;

-- SPEC §3.4: owner ✅, head 👁, accountant ✅, parent 🔸 own children; teacher/cook/club teacher — nothing.
create or replace function public.payments_viewer(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner', 'head', 'accountant']::public.app_role[])
$$;
revoke execute on function public.payments_viewer(uuid) from public, anon;
grant execute on function public.payments_viewer(uuid) to authenticated, service_role;

create or replace function public.payments_manager(kg uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.has_role(kg, array['owner', 'accountant']::public.app_role[])
$$;
revoke execute on function public.payments_manager(uuid) from public, anon;
grant execute on function public.payments_manager(uuid) to authenticated, service_role;

create policy invoices_select on public.invoices for select to authenticated
  using (public.payments_viewer(kindergarten_id) or public.is_guardian(child_id));
create policy payment_receipts_select on public.payment_receipts for select to authenticated
  using (public.payments_viewer(kindergarten_id) or public.is_guardian(child_id));
-- No insert/update/delete policies and no privileges: writes only through the functions below
-- (and receipt rows through the server with the service role after its permission checks).
revoke insert, update, delete on public.invoices from authenticated, anon;
revoke insert, update, delete on public.payment_receipts from authenticated, anon;

-- ───────────────────────────── Functions ─────────────────────────────
-- Accrual for one month (internal: cron / manual button wrapper). Idempotent: one invoice per child and month.
-- Included: active children with monthly_fee > 0 enrolled on or before the last day of the month.
-- A child added mid-month gets the full month on the next run; the accountant adjusts it with a comment.
create or replace function public.invoices_accrue(p_kg uuid, p_period date) returns int
  language plpgsql security definer set search_path = public as $$
declare
  n int;
  due int;
  p date := date_trunc('month', p_period)::date;
begin
  select payment_due_day into due from kindergarten_settings where kindergarten_id = p_kg;
  insert into invoices (kindergarten_id, child_id, period, amount_original, amount, due_date)
  select c.kindergarten_id, c.id, p, c.monthly_fee, c.monthly_fee, p + (least(greatest(coalesce(due, 10), 1), 28) - 1)
  from children c
  where c.kindergarten_id = p_kg and c.status = 'active' and c.monthly_fee > 0
    and c.enrolled_on <= (p + interval '1 month' - interval '1 day')::date
  on conflict (child_id, period) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.invoices_accrue(uuid, date) from public, anon, authenticated;
grant execute on function public.invoices_accrue(uuid, date) to service_role;

-- «Начислить за месяц» (owner/accountant): any month up to the current one in the kindergarten's time zone.
create or replace function public.accrue_invoices(p_kg uuid, p_period date) returns int
  language plpgsql security definer set search_path = public as $$
declare n int; p date := date_trunc('month', p_period)::date;
begin
  if not public.payments_manager(p_kg) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p > date_trunc('month', public.kg_today(p_kg))::date then
    raise exception 'hs:accrueFuture';
  end if;
  n := public.invoices_accrue(p_kg, p);
  if n > 0 then
    perform public.log_action(p_kg, 'invoice.accrue', 'invoice', null, jsonb_build_object('period', p, 'count', n));
  end if;
  return n;
end $$;
revoke execute on function public.accrue_invoices(uuid, date) from public, anon;
grant execute on function public.accrue_invoices(uuid, date) to authenticated, service_role;

-- Change one invoice's amount (discount, recalculation) with a mandatory comment. Audited.
create or replace function public.adjust_invoice(p_id uuid, p_amount numeric, p_comment text) returns public.invoices
  language plpgsql security definer set search_path = public as $$
declare old invoices; r invoices;
begin
  select * into old from invoices where id = p_id;
  if old.id is null or not public.payments_manager(old.kindergarten_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'hs:adjustCommentRequired';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception 'hs:numberInvalid';
  end if;
  update invoices set amount = round(p_amount, 2), adjustment_comment = trim(p_comment), adjusted_by = auth.uid(), adjusted_at = now()
  where id = p_id;
  select * into r from invoices where id = p_id;
  perform public.log_action(old.kindergarten_id, 'invoice.adjust', 'invoice', p_id::text, jsonb_build_object(
    'child_id', old.child_id, 'period', old.period, 'from', old.amount, 'to', r.amount, 'comment', trim(p_comment)));
  return r;
end $$;
revoke execute on function public.adjust_invoice(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_invoice(uuid, numeric, text) to authenticated, service_role;

-- Accept (with the confirmed amount) or reject (with a reason) a pending receipt. Owner/accountant. Audited.
create or replace function public.review_receipt(p_id uuid, p_accept boolean, p_amount numeric, p_reason text)
  returns public.payment_receipts
  language plpgsql security definer set search_path = public as $$
declare old payment_receipts; r payment_receipts; inv invoices;
begin
  select * into old from payment_receipts where id = p_id for update;
  if old.id is null or not public.payments_manager(old.kindergarten_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'hs:receiptReviewed';
  end if;
  if p_accept then
    if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
      raise exception 'hs:numberInvalid';
    end if;
    update payment_receipts set status = 'accepted', confirmed_amount = round(p_amount, 2), reject_reason = null,
      reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_id returning * into r;
  else
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'hs:rejectReasonRequired';
    end if;
    update payment_receipts set status = 'rejected', confirmed_amount = null, reject_reason = trim(p_reason),
      reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_id returning * into r;
  end if;
  select * into inv from invoices where id = old.invoice_id;
  perform public.log_action(old.kindergarten_id, case when p_accept then 'receipt.confirm' else 'receipt.reject' end,
    'payment_receipt', p_id::text, jsonb_build_object(
      'invoice_id', old.invoice_id, 'child_id', old.child_id, 'period', inv.period,
      'amount', r.confirmed_amount, 'reason', r.reject_reason, 'balance', inv.balance));
  return r;
end $$;
revoke execute on function public.review_receipt(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.review_receipt(uuid, boolean, numeric, text) to authenticated, service_role;

-- Debtors (SPEC §5.9, §6 accountant, §7 finance): children whose latest invoice has a positive balance,
-- archived children included. `since` = due date of the oldest invoice of the current unpaid streak.
-- Security invoker: RLS of invoices/children decides (owner/head/accountant see all, a parent only own children).
create or replace function public.payment_debtors(p_kg uuid)
  returns table (child_id uuid, full_name text, child_status public.child_status, group_id uuid,
                 invoice_id uuid, period date, debt numeric, since date)
  language sql stable security invoker set search_path = public as $$
  with inv as (
    select i.*, row_number() over (partition by i.child_id order by i.period desc) as rn
    from invoices i where i.kindergarten_id = p_kg
  ),
  stop as (select child_id, min(rn) as rn from inv where balance <= 0 group by child_id)
  select c.id, c.full_name, c.status, c.group_id, l.id, l.period, l.balance,
    (select min(x.due_date) from inv x where x.child_id = l.child_id and x.rn < coalesce(s.rn, 2147483647))
  from inv l
  join children c on c.id = l.child_id
  left join stop s on s.child_id = l.child_id
  where l.rn = 1 and l.balance > 0
  order by l.balance desc, c.full_name
$$;
revoke execute on function public.payment_debtors(uuid) from public, anon;
grant execute on function public.payment_debtors(uuid) to authenticated, service_role;

-- ───────────────────────────── Storage ─────────────────────────────
-- Private bucket; only the server (service role) touches it after its own checks, reads via short signed URLs.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

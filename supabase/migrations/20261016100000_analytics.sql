-- Stage 5B · Owner analytics «Аналитика» (SPEC §7). No new tables: read-only aggregates over the module tables.
--
-- Access (SPEC §3.4, row «Аналитика»): owner — everything; head — everything except finances;
-- accountant — finances only; everybody else — nothing. Every function checks the caller and the garden
-- itself (security definer, so aggregation does not pay per-row RLS costs) and is closed to public/anon.
--
-- Definitions shared with the modules (so the numbers match the module screens):
--   attendance — effective status of a child on a working day (D-018): the attendance row, otherwise «absent»
--                when an active parent report covers the day, otherwise «not marked». The roster of a day comes
--                from child_group_history (the group on that date; archived children count until they left).
--                Rate = present / (present + absent); unmarked days are left out.
--   staff      — worktime_range() (D-017), the single source of day statuses; closed days only (up to yesterday).
--   finance    — invoice columns of the FIFO balance model (D-025): amount / paid_amount / balance per month.
--   funnel     — waitlist statuses and their timeline (D-028), children enrolled_on / archived_at / archive_reason.
-- Periods are local dates of the kindergarten (its time zone); the server caps them at 400 days.

create or replace function public.analytics_guard(kg uuid, p_section text, p_from date, p_to date) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_section = 'finance' then
    if not public.has_role(kg, array['owner', 'accountant']::public.app_role[]) then
      raise exception 'hs:forbidden' using errcode = '42501';
    end if;
  elsif p_section in ('attendance', 'staff', 'funnel') then
    if not public.has_role(kg, array['owner', 'head']::public.app_role[]) then
      raise exception 'hs:forbidden' using errcode = '42501';
    end if;
  else
    raise exception 'hs:invalid';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'hs:invalid';
  end if;
end $$;
revoke execute on function public.analytics_guard(uuid, text, date, date) from public, anon;
grant execute on function public.analytics_guard(uuid, text, date, date) to authenticated, service_role;

-- ───────────────────────────── 1. Attendance and occupancy ─────────────────────────────
-- { days: [{d, enrolled, present, absent, sick, unmarked}],          working days from p_from up to min(p_to, today)
--   groups: [{id, name, color, capacity, children, present, absent, sick, unmarked}],
--   reasons: {sick, vacation, family, other, none},                   effective absences by reason
--   on_date: date }                                                    occupancy date = min(p_to, today)
create or replace function public.analytics_attendance(kg uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'attendance', p_from, p_to);
  t := least(p_to, public.kg_today(kg));
  with days as (
    select g::date as d from generate_series(p_from::timestamp, t::timestamp, interval '1 day') g
    where public.kg_is_working_day(kg, g::date)
  ),
  roster as (
    select dd.d, h.group_id, h.child_id
    from days dd
    join child_group_history h on h.kindergarten_id = kg and h.from_date <= dd.d and (h.to_date is null or h.to_date >= dd.d)
    join children c on c.id = h.child_id and c.enrolled_on <= dd.d
  ),
  rep as (
    select distinct on (x.child_id, g::date) x.child_id, g::date as d, x.reason
    from absence_reports x
    cross join lateral generate_series(greatest(x.date_from, p_from)::timestamp, least(x.date_to, t)::timestamp, interval '1 day') g
    where x.kindergarten_id = kg and x.cancelled_at is null and x.date_from <= t and x.date_to >= p_from
    order by x.child_id, g::date, x.created_at desc
  ),
  eff as (
    select r.d, r.group_id,
           coalesce(a.status, case when rp.child_id is not null then 'absent' end) as st,
           case when a.status = 'absent' then coalesce(a.reason, rp.reason)
                when a.status is null then rp.reason end as reason
    from roster r
    left join child_attendance a on a.child_id = r.child_id and a.date = r.d
    left join rep rp on rp.child_id = r.child_id and rp.d = r.d
  ),
  by_day as (
    select d, count(*)::int as enrolled,
           count(*) filter (where st = 'present')::int as present,
           count(*) filter (where st = 'absent')::int as absent,
           count(*) filter (where st = 'absent' and reason = 'sick')::int as sick,
           count(*) filter (where st is null)::int as unmarked
    from eff group by d
  ),
  by_group as (
    select group_id,
           count(*) filter (where st = 'present')::int as present,
           count(*) filter (where st = 'absent')::int as absent,
           count(*) filter (where st = 'absent' and reason = 'sick')::int as sick,
           count(*) filter (where st is null)::int as unmarked
    from eff group by group_id
  ),
  occ as (
    select h.group_id, count(*)::int as n
    from child_group_history h
    join children c on c.id = h.child_id and c.enrolled_on <= t
    where h.kindergarten_id = kg and h.from_date <= t and (h.to_date is null or h.to_date >= t)
    group by h.group_id
  )
  select jsonb_build_object(
    'on_date', t,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('d', dd.d, 'enrolled', coalesce(b.enrolled, 0), 'present', coalesce(b.present, 0),
                                          'absent', coalesce(b.absent, 0), 'sick', coalesce(b.sick, 0), 'unmarked', coalesce(b.unmarked, 0))
                       order by dd.d)
      from days dd left join by_day b on b.d = dd.d), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color, 'capacity', g.capacity,
                                          'children', coalesce(o.n, 0), 'present', coalesce(b.present, 0), 'absent', coalesce(b.absent, 0),
                                          'sick', coalesce(b.sick, 0), 'unmarked', coalesce(b.unmarked, 0))
                       order by g.sort_order, g.name)
      from groups g left join by_group b on b.group_id = g.id left join occ o on o.group_id = g.id
      where g.kindergarten_id = kg), '[]'::jsonb),
    'reasons', (
      select jsonb_build_object(
        'sick', count(*) filter (where reason = 'sick'),
        'vacation', count(*) filter (where reason = 'vacation'),
        'family', count(*) filter (where reason = 'family'),
        'other', count(*) filter (where reason = 'other'),
        'none', count(*) filter (where reason is null))
      from eff where st = 'absent')
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_attendance(uuid, date, date) from public, anon;
grant execute on function public.analytics_attendance(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── 2. Staff discipline ─────────────────────────────
-- One row per person with a schedule, marks or absences in the period. Closed days only: p_from … min(p_to, yesterday),
-- and only days since the person joined the garden (see `starts`).
-- worktime_range() covers at most 93 days per call, so longer periods are read in 93-day chunks.
create or replace function public.analytics_staff(kg uuid, p_from date, p_to date)
  returns table (user_id uuid, full_name text, archived boolean, scheduled_days int, worked_days int,
                 late_days int, late_minutes int, absent_days int, sick_days int, vacation_days int, unmarked_days int,
                 outside_days int, planned_minutes int, worked_minutes int, auto_closed_days int, edited_days int)
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
begin
  perform public.analytics_guard(kg, 'staff', p_from, p_to);
  t := least(p_to, public.kg_today(kg) - 1);
  if t < p_from then
    return;
  end if;
  return query
    with chunks as (
      select c::date as f, least(c::date + 92, t) as e
      from generate_series(p_from::timestamp, t::timestamp, interval '93 days') c
    ),
    -- worktime_range applies today's weekly template to every past day; analytics counts a person's days only from
    -- when they joined the garden (first staff membership) or from their first mark, whichever is earlier.
    starts as (
      select m.user_id as uid,
             least(min((m.created_at at time zone public.worktime_tz(kg))::date),
                   (select min(w.work_date) from work_sessions w where w.kindergarten_id = kg and w.user_id = m.user_id)) as since
      from memberships m where m.kindergarten_id = kg and m.role <> 'parent'
      group by m.user_id
    ),
    r as (
      select w.* from chunks ch cross join lateral public.worktime_range(kg, ch.f, ch.e) w
      join starts s on s.uid = w.user_id
      where w.work_date >= s.since or w.first_start is not null
    )
    select r.user_id, max(r.full_name), bool_or(r.archived),
           count(*) filter (where r.shift_start is not null)::int,
           count(*) filter (where r.first_start is not null)::int,
           count(*) filter (where r.status = 'late')::int,
           coalesce(sum(r.late_minutes) filter (where r.status = 'late'), 0)::int,
           count(*) filter (where r.status = 'absent')::int,
           count(*) filter (where r.status = 'absent' and r.absence_kind = 'sick')::int,
           count(*) filter (where r.status = 'absent' and r.absence_kind = 'vacation')::int,
           count(*) filter (where r.status = 'unmarked')::int,
           count(*) filter (where r.outside_schedule)::int,
           coalesce(sum(extract(epoch from (r.shift_end - r.shift_start)) / 60) filter (where r.shift_start is not null), 0)::int,
           coalesce(sum(r.worked_minutes), 0)::int,
           count(*) filter (where r.auto_closed)::int,
           count(*) filter (where r.edited)::int
    from r
    group by r.user_id
    having count(*) filter (where r.shift_start is not null or r.first_start is not null or r.absence_kind is not null) > 0
    order by max(r.full_name), r.user_id;
end $$;
revoke execute on function public.analytics_staff(uuid, date, date) from public, anon;
grant execute on function public.analytics_staff(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── 3. Finance ─────────────────────────────
-- { months: [{period, invoices, charged, paid, debt, overdue, paid_invoices, avg_days}],   months that intersect the period
--   debtors: [{child_id, full_name, status, group_name, debt, since, months}],              open debts as of today
--   today }
-- avg_days — days from the 1st of the month to the moment the invoice became fully paid (local date of paid_at).
create or replace function public.analytics_finance(kg uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  today date;
  tz text;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'finance', p_from, p_to);
  today := public.kg_today(kg);
  tz := coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty');
  with months as (
    select g::date as period
    from generate_series(date_trunc('month', p_from)::timestamp, date_trunc('month', p_to)::timestamp, interval '1 month') g
  ),
  per as (
    select i.period, count(*)::int as invoices, sum(i.amount) as charged, sum(i.paid_amount) as paid, sum(i.balance) as debt,
           coalesce(sum(i.balance) filter (where i.due_date < today), 0) as overdue,
           count(*) filter (where i.balance <= 0)::int as paid_invoices,
           avg(greatest(0, (i.paid_at at time zone tz)::date - i.period)) filter (where i.balance <= 0 and i.paid_at is not null) as avg_days
    from invoices i
    where i.kindergarten_id = kg and i.period in (select period from months)
    group by i.period
  ),
  debt as (
    select c.id, c.full_name, c.status, g.name as group_name, sum(i.balance) as debt, min(i.due_date) as since, count(*)::int as months
    from invoices i
    join children c on c.id = i.child_id
    left join groups g on g.id = c.group_id
    where i.kindergarten_id = kg and i.balance > 0
    group by c.id, c.full_name, c.status, g.name
  )
  select jsonb_build_object(
    'today', today,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('period', m.period, 'invoices', coalesce(p.invoices, 0), 'charged', coalesce(p.charged, 0),
                                          'paid', coalesce(p.paid, 0), 'debt', coalesce(p.debt, 0), 'overdue', coalesce(p.overdue, 0),
                                          'paid_invoices', coalesce(p.paid_invoices, 0), 'avg_days', round(p.avg_days, 1))
                       order by m.period)
      from months m left join per p on p.period = m.period), '[]'::jsonb),
    'debtors', coalesce((
      select jsonb_agg(jsonb_build_object('child_id', d.id, 'full_name', d.full_name, 'status', d.status, 'group_name', d.group_name,
                                          'debt', d.debt, 'since', d.since, 'months', d.months)
                       order by d.debt desc, d.full_name)
      from debt d), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_finance(uuid, date, date) from public, anon;
grant execute on function public.analytics_finance(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── 4. Funnel and churn ─────────────────────────────
-- { applications, contacted, accepted, declined,       applications created in the period (cohort) and how far they got
--   joined, left, left_reasons: {reason: n},           children enrolled / archived in the period
--   active: [{d, n}] }                                 active children per day, p_from … min(p_to, today)
-- «contacted» counts every application that reached «Связались» at some point (timeline) or was accepted.
create or replace function public.analytics_funnel(kg uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
  tz text;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'funnel', p_from, p_to);
  t := least(p_to, public.kg_today(kg));
  tz := coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty');
  with apps as (
    select a.id, a.status,
           a.status in ('contacted', 'accepted')
             or exists (select 1 from waitlist_comments wc where wc.application_id = a.id and wc.kind = 'status' and wc.status = 'contacted') as reached
    from waitlist_applications a
    where a.kindergarten_id = kg and (a.created_at at time zone tz)::date between p_from and p_to
  ),
  kids as (
    select c.id, c.enrolled_on, c.status, c.archive_reason,
           case when c.status = 'archived' then coalesce((c.archived_at at time zone tz)::date, t) end as left_on
    from children c where c.kindergarten_id = kg
  )
  select jsonb_build_object(
    'applications', (select count(*) from apps),
    'contacted', (select count(*) from apps where reached),
    'accepted', (select count(*) from apps where status = 'accepted'),
    'declined', (select count(*) from apps where status = 'declined'),
    'joined', (select count(*) from kids where enrolled_on between p_from and p_to),
    'left', (select count(*) from kids where left_on between p_from and p_to),
    'left_reasons', coalesce((
      select jsonb_object_agg(r, n) from (
        select coalesce(archive_reason, 'other') as r, count(*) as n from kids where left_on between p_from and p_to group by 1
      ) x), '{}'::jsonb),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object('d', g::date,
               'n', (select count(*) from kids k where k.enrolled_on <= g::date and (k.left_on is null or k.left_on > g::date)))
             order by g)
      from generate_series(p_from::timestamp, t::timestamp, interval '1 day') g), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_funnel(uuid, date, date) from public, anon;
grant execute on function public.analytics_funnel(uuid, date, date) to authenticated, service_role;

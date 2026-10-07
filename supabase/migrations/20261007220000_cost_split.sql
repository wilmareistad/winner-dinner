-- Milestone 4: cost split.
-- Rules: docs/constraints.md ("If cost split is off, no cost or amount is
-- returned by any query"), docs/ambiguity.md Story C and section 4 (Cost).
--
-- The total lives in its own table, because RLS filters rows, not columns.
-- Split off means: dinners.cost_split = false AND no dinner_costs row. Both are
-- changed together by set_cost_split, and the RLS policy checks the flag too.
-- The per-person amount is computed on read (dinner_cost), never stored.

alter table public.dinners
  add column cost_split boolean not null default false;

create table public.dinner_costs (
  dinner_id uuid primary key references public.dinners (id) on delete cascade,
  total_sek integer not null,
  constraint dinner_costs_total_range check (total_sek between 1 and 1000000)
);

revoke all on public.dinner_costs from anon, authenticated;
grant select on public.dinner_costs to authenticated;

alter table public.dinner_costs enable row level security;

create policy dinner_costs_select
  on public.dinner_costs
  for select
  to authenticated
  using (
    public.can_see_dinner(dinner_id)
    and exists (select 1 from public.dinners d where d.id = dinner_id and d.cost_split)
  );

-- The total and the amount per person. Attendees are User 1 plus the accepted
-- guests, so the divisor is at least 1. Rounded up to a whole krona.
-- No row at all when the split is off or the caller may not see the dinner.
create function public.dinner_cost(p_dinner_id uuid)
returns table (total_sek integer, attendees integer, per_person_sek integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.total_sek,
    n.attendees,
    ceil(c.total_sek::numeric / n.attendees)::integer
  from public.dinner_costs c
  join public.dinners d on d.id = c.dinner_id
  cross join lateral (
    select count(*)::integer as attendees
    from public.participants p
    where p.dinner_id = d.id and p.status = 'accepted'
  ) n
  where c.dinner_id = p_dinner_id
    and d.cost_split
    and public.can_see_dinner(p_dinner_id);
$$;

-- User 1 turns the split on with a total in whole SEK, changes the total, or
-- turns it off, which removes the stored total.
create function public.set_cost_split(p_dinner_id uuid, p_enabled boolean, p_total_sek integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  if p_enabled is null then
    raise exception 'Choose on or off.' using errcode = 'WD422';
  end if;

  if not p_enabled then
    delete from public.dinner_costs where dinner_id = d.id;
    update public.dinners set cost_split = false where id = d.id;
    return;
  end if;

  if p_total_sek is null or p_total_sek not between 1 and 1000000 then
    raise exception 'The total must be a whole number of SEK from 1 to 1,000,000.'
      using errcode = 'WD422';
  end if;

  insert into public.dinner_costs (dinner_id, total_sek)
  values (d.id, p_total_sek)
  on conflict (dinner_id) do update set total_sek = excluded.total_sek;

  update public.dinners set cost_split = true where id = d.id;
end;
$$;

revoke execute on function
  public.dinner_cost(uuid),
  public.set_cost_split(uuid, boolean, integer)
from public, anon, authenticated;

grant execute on function
  public.dinner_cost(uuid),
  public.set_cost_split(uuid, boolean, integer)
to authenticated;

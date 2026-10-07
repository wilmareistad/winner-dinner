-- Milestone 2: request management.
-- Editing the dinner, the invite link switch, every feature type (Alcohol with the
-- age confirmation, recipes on extra courses, the Entertainment label), changing
-- slots, removing features with notices, and the notices table.
-- Rules: docs/constraints.md sections 1-2, docs/scope.md "Available feature types".
--
-- Same pattern as 20261007140000_dinners.sql: clients only SELECT through RLS,
-- every write is a SECURITY DEFINER function that locks the dinner row first.
--
-- New SQLSTATEs (the list in 20261007140000_dinners.sql still applies):
--   WD421 age not confirmed     WD424 slots below filled count
--   WD428 confirmation needed (the feature has roles)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.dinners
  add column invitation_summary text,
  add constraint dinners_invitation_summary_length
    check (invitation_summary is null or char_length(invitation_summary) <= 1000);

alter table public.features
  add column label text,
  add column recipe_title text,
  add column recipe_url text,
  -- Entertainment only: board games, console games, karaoke, or free text.
  add constraint features_label_valid
    check (label is null or (type = 'entertainment' and char_length(btrim(label)) between 1 and 50)),
  -- Only extra courses have an optional recipe.
  add constraint features_recipe_type
    check ((recipe_title is null and recipe_url is null) or type in ('appetizer', 'dessert', 'snack')),
  add constraint features_recipe_title_length
    check (recipe_title is null or char_length(btrim(recipe_title)) between 1 and 100),
  add constraint features_recipe_url_format
    check (recipe_url is null or (recipe_url ~* '^https?://\S+$' and char_length(recipe_url) <= 500));

-- Home-page messages. Keyed by user id with a text copy, not by dinner, so they
-- survive the deletion of the dinner they talk about. The home-page list, dismiss
-- and the 14-day cleanup come in milestone 5.
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  constraint notices_text_length check (char_length(text) between 1 and 500)
);

create index notices_user_id_idx on public.notices (user_id, created_at desc);

revoke all on public.notices from anon, authenticated;
grant select on public.notices to authenticated;

alter table public.notices enable row level security;

create policy notices_select_own
  on public.notices
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create function public.assert_dinner_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner_id is distinct from auth.uid() then
    raise exception 'Only the creator of this request can do that.' using errcode = 'WD403';
  end if;
end;
$$;

-- Checks the fields User 1 enters for a dinner and returns the start time. Date
-- and time are entered in Swedish time. Shared by create_dinner and update_dinner.
create function public.check_dinner_fields(
  p_main_title text,
  p_date date,
  p_time time,
  p_main_url text,
  p_main_description text,
  p_short_description text,
  p_invitation_summary text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
begin
  if p_date is null or p_time is null then
    raise exception 'Choose a date and a time.' using errcode = 'WD422';
  end if;

  v_starts_at := (p_date + p_time) at time zone 'Europe/Stockholm';

  if v_starts_at <= now() then
    raise exception 'The dinner cannot be in the past.' using errcode = 'WD422';
  end if;

  if char_length(coalesce(p_main_title, '')) not between 1 and 100 then
    raise exception 'The main course needs a title of 1 to 100 characters.'
      using errcode = 'WD422';
  end if;

  if p_main_url is not null and (p_main_url !~* '^https?://\S+$' or char_length(p_main_url) > 500) then
    raise exception 'The recipe link must start with http:// or https://.'
      using errcode = 'WD422';
  end if;

  if char_length(p_main_description) > 1000 then
    raise exception 'The description can be at most 1000 characters.' using errcode = 'WD422';
  end if;

  if char_length(p_short_description) > 200 then
    raise exception 'The short description can be at most 200 characters.' using errcode = 'WD422';
  end if;

  if char_length(p_invitation_summary) > 1000 then
    raise exception 'The invitation summary can be at most 1000 characters.' using errcode = 'WD422';
  end if;

  return v_starts_at;
end;
$$;

-- The name of a feature as people see it, for notice texts. Matches
-- FEATURE_LABELS in lib/dinners.js, e.g. "Dessert: Tiramisu" or "Entertainment (Karaoke)".
create function public.feature_name(p_type text, p_label text, p_recipe_title text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select upper(left(replace(p_type, '_', ' '), 1)) || substr(replace(p_type, '_', ' '), 2)
    || coalesce(' (' || p_label || ')', '')
    || coalesce(': ' || p_recipe_title, '');
$$;

-- ---------------------------------------------------------------------------
-- Write functions
-- ---------------------------------------------------------------------------

-- Replaces the milestone 1 version, which had no invitation summary.
drop function public.create_dinner(text, date, time, text, text, text);

-- Creates a dinner. User 1 becomes an accepted participant and holds Host, which
-- is a feature with one slot.
create function public.create_dinner(
  p_main_title text,
  p_date date,
  p_time time,
  p_main_description text default null,
  p_main_url text default null,
  p_short_description text default null,
  p_invitation_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_title text := btrim(coalesce(p_main_title, ''));
  v_url text := nullif(btrim(p_main_url), '');
  v_description text := nullif(btrim(p_main_description), '');
  v_short text := nullif(btrim(p_short_description), '');
  v_summary text := nullif(btrim(p_invitation_summary), '');
  v_starts_at timestamptz;
  v_dinner_id uuid;
  v_host_id uuid;
begin
  if v_user is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  v_starts_at := public.check_dinner_fields(
    v_title, p_date, p_time, v_url, v_description, v_short, v_summary
  );

  insert into public.dinners (
    owner_id, main_title, main_url, main_description, starts_at,
    short_description, invitation_summary
  )
  values (v_user, v_title, v_url, v_description, v_starts_at, v_short, v_summary)
  returning id into v_dinner_id;

  insert into public.participants (dinner_id, user_id, status)
  values (v_dinner_id, v_user, 'accepted');

  insert into public.features (dinner_id, type, slots)
  values (v_dinner_id, 'host', 1)
  returning id into v_host_id;

  insert into public.roles (feature_id, dinner_id, user_id)
  values (v_host_id, v_dinner_id, v_user);

  return v_dinner_id;
end;
$$;

-- User 1 edits the dinner, including the main course. Guests in any status get
-- WD403. The new time must not be in the past.
create function public.update_dinner(
  p_dinner_id uuid,
  p_main_title text,
  p_date date,
  p_time time,
  p_main_description text default null,
  p_main_url text default null,
  p_short_description text default null,
  p_invitation_summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
  v_title text := btrim(coalesce(p_main_title, ''));
  v_url text := nullif(btrim(p_main_url), '');
  v_description text := nullif(btrim(p_main_description), '');
  v_short text := nullif(btrim(p_short_description), '');
  v_summary text := nullif(btrim(p_invitation_summary), '');
  v_starts_at timestamptz;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  v_starts_at := public.check_dinner_fields(
    v_title, p_date, p_time, v_url, v_description, v_short, v_summary
  );

  update public.dinners
  set main_title = v_title,
      main_url = v_url,
      main_description = v_description,
      starts_at = v_starts_at,
      short_description = v_short,
      invitation_summary = v_summary
  where id = d.id;
end;
$$;

-- User 1 turns the invite link on or off. Off blocks new joins only; existing
-- participants keep access (join_by_token lets them through).
create function public.set_link_enabled(p_dinner_id uuid, p_enabled boolean)
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

  update public.dinners set link_enabled = p_enabled where id = d.id;
end;
$$;

-- Replaces the milestone 1 version, which refused Alcohol and had no recipe or label.
drop function public.add_feature(uuid, text, integer);

-- User 1 adds a feature. Host comes with the dinner. Alcohol needs
-- p_age_confirmed = true (the modal alone is not enough). Appetizer, Dessert and
-- Snack can have a recipe and be added several times. Entertainment can have a label.
create function public.add_feature(
  p_dinner_id uuid,
  p_type text,
  p_slots integer,
  p_age_confirmed boolean default false,
  p_recipe_title text default null,
  p_recipe_url text default null,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
  v_recipe_title text := nullif(btrim(p_recipe_title), '');
  v_recipe_url text := nullif(btrim(p_recipe_url), '');
  v_label text := nullif(btrim(p_label), '');
  v_feature_id uuid;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  if p_type is null or p_type not in (
    'main_course', 'appetizer', 'dessert', 'snack', 'alcohol',
    'soft_drinks', 'grocery_shopping', 'cleanup', 'entertainment'
  ) then
    raise exception 'This feature cannot be added.' using errcode = 'WD422';
  end if;

  if p_slots is null or p_slots not between 1 and 30 then
    raise exception 'Slots must be between 1 and 30.' using errcode = 'WD422';
  end if;

  if p_type = 'alcohol' and p_age_confirmed is not true then
    raise exception 'Alcohol can only be added if everyone invited is over 18.'
      using errcode = 'WD421';
  end if;

  if (v_recipe_title is not null or v_recipe_url is not null)
    and p_type not in ('appetizer', 'dessert', 'snack') then
    raise exception 'Only appetizers, desserts and snacks can have a recipe.' using errcode = 'WD422';
  end if;

  if char_length(v_recipe_title) > 100 then
    raise exception 'The recipe title can be at most 100 characters.' using errcode = 'WD422';
  end if;

  if v_recipe_url is not null and (v_recipe_url !~* '^https?://\S+$' or char_length(v_recipe_url) > 500) then
    raise exception 'The recipe link must start with http:// or https://.' using errcode = 'WD422';
  end if;

  if v_label is not null and p_type <> 'entertainment' then
    raise exception 'Only Entertainment can have a label.' using errcode = 'WD422';
  end if;

  if char_length(v_label) > 50 then
    raise exception 'The label can be at most 50 characters.' using errcode = 'WD422';
  end if;

  -- The unique index enforces this too. Checking first gives a clear message.
  if p_type not in ('appetizer', 'dessert', 'snack') and exists (
    select 1 from public.features where dinner_id = d.id and type = p_type
  ) then
    raise exception 'This feature can only be added once.' using errcode = 'WD405';
  end if;

  insert into public.features (dinner_id, type, slots, label, recipe_title, recipe_url)
  values (d.id, p_type, p_slots, v_label, v_recipe_title, v_recipe_url)
  returning id into v_feature_id;

  return v_feature_id;
end;
$$;

-- User 1 changes how many people a feature takes. Never below the number of
-- roles already held, and Host always has one slot.
create function public.set_slots(p_feature_id uuid, p_slots integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dinner_id uuid;
  d public.dinners;
  f public.features;
  v_filled integer;
begin
  select dinner_id into v_dinner_id from public.features where id = p_feature_id;
  if not found then
    raise exception 'This feature no longer exists.' using errcode = 'WD404';
  end if;

  d := public.lock_dinner(v_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  -- Read again under the lock: it may have been removed while we waited.
  select * into f from public.features where id = p_feature_id;
  if not found then
    raise exception 'This feature no longer exists.' using errcode = 'WD404';
  end if;

  if p_slots is null or p_slots not between 1 and 30 then
    raise exception 'Slots must be between 1 and 30.' using errcode = 'WD422';
  end if;

  if f.type = 'host' and p_slots <> 1 then
    raise exception 'Host always has one slot.' using errcode = 'WD422';
  end if;

  select count(*) into v_filled from public.roles where feature_id = f.id;

  if p_slots < v_filled then
    raise exception '% of the slots are filled. You cannot go below %.', v_filled, v_filled
      using errcode = 'WD424';
  end if;

  update public.features set slots = p_slots where id = f.id;
end;
$$;

-- User 1 removes a feature. If anyone holds it, p_confirm must be true, so a
-- stale screen that showed it empty cannot remove someone's role unasked. The
-- roles go with the feature (cascade), and every holder except User 1 gets a notice.
-- Removing a feature that is already gone is not an error, so a retry is safe.
create function public.remove_feature(p_feature_id uuid, p_confirm boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dinner_id uuid;
  d public.dinners;
  f public.features;
  v_filled integer;
  v_text text;
begin
  select dinner_id into v_dinner_id from public.features where id = p_feature_id;
  if not found then
    return;
  end if;

  d := public.lock_dinner(v_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  select * into f from public.features where id = p_feature_id;
  if not found then
    return;
  end if;

  if f.type = 'host' then
    raise exception 'Host is a fixed role and cannot be removed.' using errcode = 'WD422';
  end if;

  select count(*) into v_filled from public.roles where feature_id = f.id;

  if v_filled > 0 and p_confirm is not true then
    raise exception '% this feature. Removing it also removes their roles.',
      case when v_filled = 1 then '1 person holds' else v_filled || ' people hold' end
      using errcode = 'WD428';
  end if;

  v_text := format(
    '%s was removed from "%s" (%s). Your role there is gone.',
    public.feature_name(f.type, f.label, f.recipe_title),
    d.main_title,
    to_char(d.starts_at at time zone 'Europe/Stockholm', 'FMDD FMMonth YYYY, HH24:MI')
  );

  insert into public.notices (user_id, text)
  select r.user_id, v_text
  from public.roles r
  where r.feature_id = f.id and r.user_id <> d.owner_id;

  delete from public.features where id = f.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.assert_dinner_owner(uuid),
  public.check_dinner_fields(text, date, time, text, text, text, text),
  public.feature_name(text, text, text),
  public.create_dinner(text, date, time, text, text, text, text),
  public.update_dinner(uuid, text, date, time, text, text, text, text),
  public.set_link_enabled(uuid, boolean),
  public.add_feature(uuid, text, integer, boolean, text, text, text),
  public.set_slots(uuid, integer),
  public.remove_feature(uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.create_dinner(text, date, time, text, text, text, text),
  public.update_dinner(uuid, text, date, time, text, text, text, text),
  public.set_link_enabled(uuid, boolean),
  public.add_feature(uuid, text, integer, boolean, text, text, text),
  public.set_slots(uuid, integer),
  public.remove_feature(uuid, boolean)
to authenticated;

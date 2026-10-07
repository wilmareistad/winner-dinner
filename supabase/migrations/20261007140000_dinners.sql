-- Milestone 1: thin vertical slice.
-- Dinners, participants, features and roles, with RLS and the write functions.
-- Rules: docs/constraints.md sections 1-2, docs/ambiguity.md sections 2 and 4.
--
-- Clients only SELECT, filtered by RLS. Every write goes through a SECURITY DEFINER
-- function below. Each function that changes a dinner first locks the dinner row
-- (lock_dinner), which serializes claims, answers and feature changes on it.
--
-- Errors use custom SQLSTATEs so the app can tell them apart (lib/dinners.js):
--   WD000 not logged in          WD403 not allowed           WD404 not found
--   WD405 feature only once      WD408 already holds role    WD409 feature full
--   WD410 link not valid         WD411 blocked from request  WD412 not accepted
--   WD422 invalid input          WD423 read-only             WD429 two-role limit

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.dinners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- 144 random bits, URL-safe. Separate from the id so the id is never a key to join.
  invite_token text not null
    default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
  link_enabled boolean not null default true,
  main_title text not null,
  main_url text,
  main_description text,
  starts_at timestamptz not null,
  short_description text,
  created_at timestamptz not null default now(),
  constraint dinners_invite_token_unique unique (invite_token),
  constraint dinners_main_title_length
    check (char_length(btrim(main_title)) between 1 and 100),
  -- Only http(s), so the link can never be a javascript: URL.
  constraint dinners_main_url_format
    check (main_url is null or (main_url ~* '^https?://\S+$' and char_length(main_url) <= 500)),
  constraint dinners_main_description_length
    check (main_description is null or char_length(main_description) <= 1000),
  constraint dinners_short_description_length
    check (short_description is null or char_length(short_description) <= 200)
);

create index dinners_owner_id_idx on public.dinners (owner_id);

-- User 1 also has a row here, always 'accepted'.
create table public.participants (
  dinner_id uuid not null references public.dinners (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dinner_id, user_id),
  constraint participants_status_valid
    check (status in ('invited', 'accepted', 'declined', 'kicked'))
);

create index participants_user_id_idx on public.participants (user_id);

create table public.features (
  id uuid primary key default gen_random_uuid(),
  dinner_id uuid not null references public.dinners (id) on delete cascade,
  type text not null,
  slots integer not null,
  created_at timestamptz not null default now(),
  -- Target for the composite foreign key on roles.
  constraint features_id_dinner_unique unique (id, dinner_id),
  constraint features_type_valid check (type in (
    'host', 'main_course', 'appetizer', 'dessert', 'snack', 'alcohol',
    'soft_drinks', 'grocery_shopping', 'cleanup', 'entertainment'
  )),
  constraint features_slots_range check (slots between 1 and 30),
  constraint features_host_one_slot check (type <> 'host' or slots = 1)
);

create index features_dinner_id_idx on public.features (dinner_id);

-- Only Appetizer, Dessert and Snack may be added more than once per dinner.
-- This also gives one Host and one Main course per dinner.
create unique index features_once_per_dinner
  on public.features (dinner_id, type)
  where type not in ('appetizer', 'dessert', 'snack');

create table public.roles (
  feature_id uuid not null,
  dinner_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  -- One role per feature per user (docs/ambiguity.md, Q-A2).
  primary key (feature_id, user_id),
  -- dinner_id must be the feature's dinner, and the holder a participant of it.
  constraint roles_feature_fkey foreign key (feature_id, dinner_id)
    references public.features (id, dinner_id) on delete cascade,
  constraint roles_participant_fkey foreign key (dinner_id, user_id)
    references public.participants (dinner_id, user_id) on delete cascade
);

create index roles_dinner_user_idx on public.roles (dinner_id, user_id);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

-- Supabase's default privileges grant everything to anon and authenticated.
-- Take it all back, then allow reading only.
revoke all on public.dinners, public.participants, public.features, public.roles
  from anon, authenticated;
grant select on public.dinners, public.participants, public.features, public.roles
  to authenticated;

alter table public.dinners enable row level security;
alter table public.participants enable row level security;
alter table public.features enable row level security;
alter table public.roles enable row level security;

-- The caller is User 1 of the dinner, or a participant who is not kicked.
-- SECURITY DEFINER so policies can use it without recursing into RLS.
create function public.can_see_dinner(p_dinner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dinners d
    where d.id = p_dinner_id and d.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.participants p
    where p.dinner_id = p_dinner_id
      and p.user_id = (select auth.uid())
      and p.status <> 'kicked'
  );
$$;

create function public.is_dinner_owner(p_dinner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dinners d
    where d.id = p_dinner_id and d.owner_id = (select auth.uid())
  );
$$;

create policy dinners_select
  on public.dinners
  for select
  to authenticated
  using (public.can_see_dinner(id));

-- Guests see accepted participants and their own row. Declined and invited guests
-- are hidden from other guests. User 1 sees everyone.
create policy participants_select
  on public.participants
  for select
  to authenticated
  using (
    public.can_see_dinner(dinner_id)
    and (
      status = 'accepted'
      or user_id = (select auth.uid())
      or public.is_dinner_owner(dinner_id)
    )
  );

-- Invited guests may see features and roles too (docs/ambiguity.md, Q-A1).
create policy features_select
  on public.features
  for select
  to authenticated
  using (public.can_see_dinner(dinner_id));

create policy roles_select
  on public.roles
  for select
  to authenticated
  using (public.can_see_dinner(dinner_id));

-- People on a dinner with the profile fields the caller may see. The same row
-- rules as participants_select. display_name only for User 1 and the user
-- themselves (docs/ambiguity.md, profile visibility). profiles RLS stays own-row.
create function public.dinner_people(p_dinner_id uuid)
returns table (
  user_id uuid,
  username text,
  emoji text,
  display_name text,
  status text,
  is_owner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.user_id,
    pr.username::text,
    pr.emoji,
    case
      when d.owner_id = (select auth.uid()) or p.user_id = (select auth.uid())
        then pr.display_name
    end,
    p.status,
    p.user_id = d.owner_id
  from public.participants p
  join public.dinners d on d.id = p.dinner_id
  join public.profiles pr on pr.id = p.user_id
  where p.dinner_id = p_dinner_id
    and public.can_see_dinner(p_dinner_id)
    and (
      p.status = 'accepted'
      or p.user_id = (select auth.uid())
      or d.owner_id = (select auth.uid())
    )
  order by p.user_id = d.owner_id desc, p.created_at, pr.username;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

-- Locks the dinner row and returns it. Fails with "Request not found" if it does
-- not exist or the caller may not see it, so nothing leaks to outsiders.
create function public.lock_dinner(p_dinner_id uuid)
returns public.dinners
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
begin
  if auth.uid() is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  select * into d from public.dinners where id = p_dinner_id for update;

  if not found or not public.can_see_dinner(d.id) then
    raise exception 'Request not found.' using errcode = 'WD404';
  end if;

  return d;
end;
$$;

-- Read-only from the dinner time on. Checked with now(), not by a job.
create function public.assert_not_read_only(p_starts_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if now() >= p_starts_at then
    raise exception 'This dinner has started. The request is read-only.'
      using errcode = 'WD423';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write functions (the only way clients change data)
-- ---------------------------------------------------------------------------

-- Creates a dinner. Date and time are entered in Swedish time. User 1 becomes an
-- accepted participant and holds Host, which is a feature with one slot.
create function public.create_dinner(
  p_main_title text,
  p_date date,
  p_time time,
  p_main_description text default null,
  p_main_url text default null,
  p_short_description text default null
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
  v_starts_at timestamptz;
  v_dinner_id uuid;
  v_host_id uuid;
begin
  if v_user is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  if p_date is null or p_time is null then
    raise exception 'Choose a date and a time.' using errcode = 'WD422';
  end if;

  v_starts_at := (p_date + p_time) at time zone 'Europe/Stockholm';

  if v_starts_at <= now() then
    raise exception 'The dinner cannot be in the past.' using errcode = 'WD422';
  end if;

  if char_length(v_title) not between 1 and 100 then
    raise exception 'The main course needs a title of 1 to 100 characters.'
      using errcode = 'WD422';
  end if;

  if v_url is not null and v_url !~* '^https?://\S+$' then
    raise exception 'The recipe link must start with http:// or https://.'
      using errcode = 'WD422';
  end if;

  insert into public.dinners (owner_id, main_title, main_url, main_description, starts_at, short_description)
  values (
    v_user,
    v_title,
    v_url,
    nullif(btrim(p_main_description), ''),
    v_starts_at,
    nullif(btrim(p_short_description), '')
  )
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

-- Opens an invite link. Returns the dinner id the caller may now open.
-- Existing participants (except kicked) always get in, even if the link is disabled
-- or the dinner has started. New users join as 'invited' only while the link is
-- enabled and the dinner has not started.
create function public.join_by_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d public.dinners;
  v_status text;
begin
  if v_user is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  select * into d from public.dinners where invite_token = p_token for update;

  if not found then
    raise exception 'This link is not valid.' using errcode = 'WD410';
  end if;

  if d.owner_id = v_user then
    return d.id;
  end if;

  select status into v_status
  from public.participants
  where dinner_id = d.id and user_id = v_user;

  if v_status = 'kicked' then
    raise exception 'You can''t join this request.' using errcode = 'WD411';
  end if;

  if v_status is not null then
    return d.id;
  end if;

  -- Same message as an unknown token, so a disabled or past dinner leaks nothing.
  if not d.link_enabled or now() >= d.starts_at then
    raise exception 'This link is not valid.' using errcode = 'WD410';
  end if;

  insert into public.participants (dinner_id, user_id, status)
  values (d.id, v_user, 'invited');

  return d.id;
end;
$$;

-- A guest answers the invitation. Leaving 'accepted' frees all their roles in the
-- same transaction. The 30-guest limit is added here in milestone 3.
create function public.set_answer(p_dinner_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d public.dinners;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);

  if d.owner_id = v_user then
    raise exception 'The creator of a request is always coming.' using errcode = 'WD403';
  end if;

  if p_answer is null or p_answer not in ('accepted', 'declined') then
    raise exception 'The answer must be accepted or declined.' using errcode = 'WD422';
  end if;

  if p_answer <> 'accepted' then
    delete from public.roles where dinner_id = d.id and user_id = v_user;
  end if;

  update public.participants
  set status = p_answer, updated_at = now()
  where dinner_id = d.id and user_id = v_user;
end;
$$;

-- User 1 adds a feature. Host is created with the dinner. Alcohol needs the age
-- confirmation, which is added in milestone 2, so it is refused until then.
create function public.add_feature(p_dinner_id uuid, p_type text, p_slots integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
  v_feature_id uuid;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);

  if d.owner_id <> auth.uid() then
    raise exception 'Only the creator of this request can do that.' using errcode = 'WD403';
  end if;

  if p_type is null or p_type not in (
    'main_course', 'appetizer', 'dessert', 'snack',
    'soft_drinks', 'grocery_shopping', 'cleanup', 'entertainment'
  ) then
    raise exception 'This feature cannot be added.' using errcode = 'WD422';
  end if;

  if p_slots is null or p_slots not between 1 and 30 then
    raise exception 'Slots must be between 1 and 30.' using errcode = 'WD422';
  end if;

  -- The unique index enforces this too. Checking first gives a clear message.
  if p_type not in ('appetizer', 'dessert', 'snack') and exists (
    select 1 from public.features where dinner_id = d.id and type = p_type
  ) then
    raise exception 'This feature can only be added once.' using errcode = 'WD405';
  end if;

  insert into public.features (dinner_id, type, slots)
  values (d.id, p_type, p_slots)
  returning id into v_feature_id;

  return v_feature_id;
end;
$$;

-- The caller takes one slot of a feature. Serialized by the dinner lock, so the
-- slot count and the two-role limit cannot be raced.
create function public.claim_role(p_feature_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_dinner_id uuid;
  d public.dinners;
  f public.features;
begin
  select dinner_id into v_dinner_id from public.features where id = p_feature_id;
  if not found then
    raise exception 'This feature no longer exists.' using errcode = 'WD404';
  end if;

  d := public.lock_dinner(v_dinner_id);
  perform public.assert_not_read_only(d.starts_at);

  -- Read again under the lock: it may have been removed while we waited.
  select * into f from public.features where id = p_feature_id;
  if not found then
    raise exception 'This feature no longer exists.' using errcode = 'WD404';
  end if;

  if not exists (
    select 1 from public.participants
    where dinner_id = d.id and user_id = v_user and status = 'accepted'
  ) then
    raise exception 'Accept the invitation before you take a role.' using errcode = 'WD412';
  end if;

  if exists (
    select 1 from public.roles where feature_id = f.id and user_id = v_user
  ) then
    raise exception 'You already have this role.' using errcode = 'WD408';
  end if;

  if (select count(*) from public.roles where dinner_id = d.id and user_id = v_user) >= 2 then
    raise exception 'You can hold at most two roles.' using errcode = 'WD429';
  end if;

  if (select count(*) from public.roles where feature_id = f.id) >= f.slots then
    raise exception 'This feature is full.' using errcode = 'WD409';
  end if;

  insert into public.roles (feature_id, dinner_id, user_id)
  values (f.id, d.id, v_user);
end;
$$;

-- The caller gives up their own role. Doing it twice is not an error, so a retry
-- after a network failure is safe.
create function public.unclaim_role(p_feature_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dinner_id uuid;
  d public.dinners;
begin
  select dinner_id into v_dinner_id from public.features where id = p_feature_id;
  if not found then
    return;
  end if;

  d := public.lock_dinner(v_dinner_id);
  perform public.assert_not_read_only(d.starts_at);

  delete from public.roles
  where feature_id = p_feature_id and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.can_see_dinner(uuid),
  public.is_dinner_owner(uuid),
  public.dinner_people(uuid),
  public.lock_dinner(uuid),
  public.assert_not_read_only(timestamptz),
  public.create_dinner(text, date, time, text, text, text),
  public.join_by_token(text),
  public.set_answer(uuid, text),
  public.add_feature(uuid, text, integer),
  public.claim_role(uuid),
  public.unclaim_role(uuid)
from public, anon, authenticated;

-- RLS helpers must be executable by the role the policies run as.
grant execute on function
  public.can_see_dinner(uuid),
  public.is_dinner_owner(uuid),
  public.dinner_people(uuid),
  public.create_dinner(text, date, time, text, text, text),
  public.join_by_token(text),
  public.set_answer(uuid, text),
  public.add_feature(uuid, text, integer),
  public.claim_role(uuid),
  public.unclaim_role(uuid)
to authenticated;

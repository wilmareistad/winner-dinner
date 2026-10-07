-- Milestone 3: guest management.
-- Kick, re-add, the 30-guest limit, and "a role exists only while its holder is
-- accepted" as a rule of the tables themselves.
-- Rules: docs/constraints.md section 2 (guest state machine, invariants),
-- docs/ambiguity.md decisions 1-3, 7, 8 and Story B.
--
-- New SQLSTATE (the lists in the earlier migrations still apply):
--   WD430 request full (30 accepted guests)

-- ---------------------------------------------------------------------------
-- Invariant: roles only for accepted participants
-- ---------------------------------------------------------------------------

-- The write functions already check this. The triggers make it hold for any
-- write, so no path can leave a role with a guest who is not coming.

-- A new role needs an accepted holder. User 1 always has an accepted row.
create function public.roles_require_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.participants
    where dinner_id = new.dinner_id and user_id = new.user_id and status = 'accepted'
  ) then
    raise exception 'Accept the invitation before you take a role.' using errcode = 'WD412';
  end if;
  return new;
end;
$$;

create trigger roles_require_accepted
  before insert or update on public.roles
  for each row execute function public.roles_require_accepted();

-- Leaving 'accepted' frees every role in the same transaction.
create function public.participants_free_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.roles where dinner_id = new.dinner_id and user_id = new.user_id;
  return new;
end;
$$;

create trigger participants_free_roles
  after update of status on public.participants
  for each row
  when (old.status = 'accepted' and new.status <> 'accepted')
  execute function public.participants_free_roles();

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

-- At most 30 accepted guests. User 1 is not counted, invited and declined are
-- not counted. Call it with the dinner locked, before a guest becomes accepted.
create function public.assert_guest_room(d public.dinners)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.participants
    where dinner_id = d.id and status = 'accepted' and user_id <> d.owner_id
  ) >= 30 then
    raise exception 'This request is full. 30 guests are already coming.' using errcode = 'WD430';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write functions
-- ---------------------------------------------------------------------------

-- Replaces the milestone 1 version: adds the 30-guest limit. Leaving 'accepted'
-- frees the roles through the participants_free_roles trigger.
create or replace function public.set_answer(p_dinner_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d public.dinners;
  v_status text;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);

  if d.owner_id = v_user then
    raise exception 'The creator of a request is always coming.' using errcode = 'WD403';
  end if;

  if p_answer is null or p_answer not in ('accepted', 'declined') then
    raise exception 'The answer must be accepted or declined.' using errcode = 'WD422';
  end if;

  -- lock_dinner lets only User 1 and non-kicked participants through.
  select status into v_status
  from public.participants
  where dinner_id = d.id and user_id = v_user;

  if v_status = p_answer then
    return;
  end if;

  if p_answer = 'accepted' then
    perform public.assert_guest_room(d);
  end if;

  update public.participants
  set status = p_answer, updated_at = now()
  where dinner_id = d.id and user_id = v_user;
end;
$$;

-- User 1 removes a guest. Their roles are freed at once (trigger), they are
-- blocked from the link and the request, and no notice is sent (Q-B2).
-- Kicking someone already kicked is not an error, so a retry is safe.
create function public.kick_guest(p_dinner_id uuid, p_user_id uuid)
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

  if p_user_id = d.owner_id then
    raise exception 'You cannot remove yourself from your own request.' using errcode = 'WD422';
  end if;

  if not exists (
    select 1 from public.participants where dinner_id = d.id and user_id = p_user_id
  ) then
    raise exception 'This guest is not on the request.' using errcode = 'WD404';
  end if;

  update public.participants
  set status = 'kicked', updated_at = now()
  where dinner_id = d.id and user_id = p_user_id and status <> 'kicked';
end;
$$;

-- User 1 re-adds a kicked guest, found by username among the kicked guests of
-- this dinner only (no global user search). They come back as 'invited' with no
-- roles, and the 30-guest limit is checked when they accept again.
create function public.readd_guest(p_dinner_id uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dinners;
  v_user_id uuid;
begin
  d := public.lock_dinner(p_dinner_id);
  perform public.assert_not_read_only(d.starts_at);
  perform public.assert_dinner_owner(d.owner_id);

  select p.user_id into v_user_id
  from public.participants p
  join public.profiles pr on pr.id = p.user_id
  where p.dinner_id = d.id
    and p.status = 'kicked'
    -- Usernames are stored lowercase (profiles_username_format). Plain text
    -- comparison, since the citext operator is not on the empty search_path.
    and pr.username::text = lower(btrim(coalesce(p_username, '')));

  if v_user_id is null then
    raise exception 'No removed guest with that username.' using errcode = 'WD404';
  end if;

  update public.participants
  set status = 'invited', updated_at = now()
  where dinner_id = d.id and user_id = v_user_id;

  return v_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.roles_require_accepted(),
  public.participants_free_roles(),
  public.assert_guest_room(public.dinners),
  public.kick_guest(uuid, uuid),
  public.readd_guest(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.kick_guest(uuid, uuid),
  public.readd_guest(uuid, text)
to authenticated;

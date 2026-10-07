-- Milestone 5: profile, notices and account deletion.
-- Rules: docs/constraints.md section 2 (Lifecycle: account deletion, notices),
-- section 3 (account deletion runs server-side, one transaction), and
-- docs/ambiguity.md section 4 (profile visibility, notices).
--
-- Account deletion is a SECURITY DEFINER function, not a route with the
-- service-role key: the caller's identity comes only from auth.uid(), the
-- function takes no user id at all, and no elevated key exists in the app.
-- Deleting the auth.users row cascades to profiles and everything keyed by the
-- user id in the same transaction as the notices.

-- ---------------------------------------------------------------------------
-- pg_cron (https://supabase.com/docs/guides/cron/install)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ---------------------------------------------------------------------------
-- Notices: hidden after 14 days, dismissable, cleaned up by a job
-- ---------------------------------------------------------------------------

create index notices_created_at_idx on public.notices (created_at);

-- Older than 14 days is hidden at once, even before the cleanup job has run.
drop policy notices_select_own on public.notices;

create policy notices_select_own
  on public.notices
  for select
  to authenticated
  using (user_id = (select auth.uid()) and created_at > now() - interval '14 days');

-- The caller removes one of their own notices. Gone already is not an error.
create function public.dismiss_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  delete from public.notices where id = p_notice_id and user_id = auth.uid();
end;
$$;

-- Hourly. A failed run simply leaves the rows for the next run, and RLS
-- already hides them. Scheduling by name replaces an existing job.
select cron.schedule(
  'wd-cleanup-notices',
  '17 * * * *',
  $$delete from public.notices where created_at < now() - interval '14 days'$$
);

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

-- The caller edits their own name and emoji. Empty clears the field. The
-- username cannot be changed (docs/ambiguity.md section 4).
create function public.update_profile(p_display_name text, p_emoji text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_display_name), '');
  v_emoji text := nullif(btrim(p_emoji), '');
begin
  if auth.uid() is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  if char_length(v_name) > 50 then
    raise exception 'The name can be at most 50 characters.' using errcode = 'WD422';
  end if;

  -- An emoji: short, and no plain ASCII (letters, digits, spaces, markup).
  if v_emoji is not null and (char_length(v_emoji) > 16 or v_emoji ~ '[\x01-\x7F]') then
    raise exception 'Choose one emoji.' using errcode = 'WD422';
  end if;

  update public.profiles
  set display_name = v_name, emoji = v_emoji
  where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting a dinner, and deleting an account
-- ---------------------------------------------------------------------------

-- Notices for everyone on a dinner that is about to be deleted, except User 1
-- and kicked guests (a kicked user gets no messages about the dinner, Q-B2).
-- A text copy, so the notice survives the dinner.
create function public.notify_dinner_deleted(d public.dinners, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notices (user_id, text)
  select p.user_id,
    format(
      '"%s" (%s) was deleted %s.',
      d.main_title,
      to_char(d.starts_at at time zone 'Europe/Stockholm', 'FMDD FMMonth YYYY, HH24:MI'),
      p_reason
    )
  from public.participants p
  where p.dinner_id = d.id
    and p.user_id <> d.owner_id
    and p.status <> 'kicked';
end;
$$;

-- User 1 deletes their request. Features, roles, participants and the invite
-- link go with it (cascade). Guests get a notice. Not after the dinner time:
-- the request is read-only then, and the cleanup job removes it later.
create function public.delete_dinner(p_dinner_id uuid)
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

  perform public.notify_dinner_deleted(d, 'by its creator');
  delete from public.dinners where id = d.id;
end;
$$;

-- The caller deletes their own account. Takes no parameters: the identity is
-- auth.uid() only. In one transaction:
-- 1. lock and notify the guests of every dinner the caller created,
-- 2. delete the auth user, which cascades to the profile, those dinners (with
--    features, roles, participants), the caller's guest rows and roles on other
--    dinners, and their notices.
-- Cascades are not blocked by the read-only check (it lives only in the write
-- functions), so past dinners are removed too. Any error rolls back all of it.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d public.dinners;
begin
  if v_user is null then
    raise exception 'You need to log in first.' using errcode = 'WD000';
  end if;

  for d in
    select * from public.dinners where owner_id = v_user order by id for update
  loop
    perform public.notify_dinner_deleted(d, 'because its creator deleted their account');
  end loop;

  delete from auth.users where id = v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.dismiss_notice(uuid),
  public.update_profile(text, text),
  public.notify_dinner_deleted(public.dinners, text),
  public.delete_dinner(uuid),
  public.delete_my_account()
from public, anon, authenticated;

grant execute on function
  public.dismiss_notice(uuid),
  public.update_profile(text, text),
  public.delete_dinner(uuid),
  public.delete_my_account()
to authenticated;

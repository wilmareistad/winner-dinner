-- Milestone 0: profiles and username-only login.
-- Rules: docs/ambiguity.md section 4 (username rules, identity by uuid).

create extension if not exists citext with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null,
  display_name text,
  emoji text,
  created_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  -- Cast to text: the citext regex operator would ignore case.
  constraint profiles_username_format check (username::text ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 50),
  constraint profiles_emoji_length
    check (emoji is null or char_length(emoji) between 1 and 16)
);

alter table public.profiles enable row level security;

-- Clients may only read. Writes come from the trigger below (and later from
-- SECURITY DEFINER functions). Reading co-participants' profiles is added in M1.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- The username is taken from the hidden email, never from client metadata,
-- so a direct API call cannot register one username and display another.
-- Keep the domain in sync with HIDDEN_EMAIL_DOMAIN in lib/auth.js.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.email) not like '%@users.winnerdinner.app' then
    raise exception 'Sign-up is only allowed with a username'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, username)
  values (new.id, split_part(lower(new.email), '@', 1));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The email is the username. Changing it would desync the two.
create function public.prevent_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'The username cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_change
  before update of email on auth.users
  for each row execute function public.prevent_email_change();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_email_change() from public, anon, authenticated;

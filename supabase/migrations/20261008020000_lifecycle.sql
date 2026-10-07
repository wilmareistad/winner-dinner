-- Milestone 6: lifecycle.
-- Read-only from the dinner time is checked in every write function since
-- milestone 1 (assert_not_read_only, with now()). This adds the cleanup:
-- dinners are deleted 2 weeks after the dinner time, without a warning
-- (docs/ambiguity.md decision 6). Rules: docs/constraints.md section 2 (Lifecycle).

create index dinners_starts_at_idx on public.dinners (starts_at);

-- Deletes every dinner whose time is more than 14 days ago. One statement, so
-- one transaction: features, roles, participants, costs and the invite link
-- (a column on the dinner) go together through the cascades. If a run fails,
-- nothing is deleted and the next run tries again; the dinners stay read-only
-- in the meantime. A dinner locked by a running function is deleted when the
-- lock is released. Returns how many were deleted.
create function public.cleanup_old_dinners()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.dinners
    where starts_at < now() - interval '14 days'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function public.cleanup_old_dinners() from public, anon, authenticated;

-- Hourly. Scheduling by name replaces an existing job.
select cron.schedule('wd-cleanup-dinners', '43 * * * *', $$select public.cleanup_old_dinners()$$);

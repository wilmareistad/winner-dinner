# WinnerDinner 2000

Social app where users request, shop for, or cook a dinner and spread the work between friends.

## Source of truth
- `docs/scope.md`: what to build and what NOT to build.
- `docs/constraints.md`: permissions, data and state, dependencies, scale, failure modes.
- `docs/ambiguity.md`: decided rules and out-of-scope gaps.
- `PLAN.md`: the approved milestone plan (once it exists).

Read these at the start of each session. If code and these files disagree, stop and ask.
Items tagged **PO WILL ANSWER** are open: do not guess. List them in the plan, ask, or use the stated proposal behind an easy-to-change seam.
Items tagged **OUT OF SCOPE (v1)** are deliberate gaps: do not build them.

## Stack
- Next.js (JavaScript) on Vercel
- Supabase (Postgres, Auth, RLS, pg_cron). Dev project only.
- Tests: Vitest. SQL/RLS tests run with `pg` against the dev database inside transactions that are always rolled back (`tests/db/helpers.js`). Race tests use `race()` from the same file.

## Commands
- Dev: `npm run dev`
- Test: `npm test`
- Lint: `npm run lint`
- Migrations: files in `supabase/migrations/`. Preview with `npm run db:push -- --dry-run`, apply with `npm run db:push`. Never apply without my approval.

## Rules
- One milestone at a time. Plan first, then code. Do not start the next milestone.
- Enforce business rules in the database (constraints, triggers, functions with locks), not only in the UI or JavaScript. This covers the two-role limit, slot limits, the 30-guest limit, the guest state machine, and read-only after the dinner date.
- Access control goes through Supabase Row Level Security, not client-side checks. If cost split is off, no amount may be returned by any query.
- Every rule in docs/scope.md and docs/constraints.md gets a test, for example "third role claim is rejected", "kicked user cannot open the link", "last slot claimed by two users at once gives one success".
- Never commit secrets. Never use or request production keys or the service-role key in client code. Elevated operations (account deletion) run server-side only.
- Username login: hidden-email approach (see docs/ambiguity.md, section 4). Keep it consistent.
- Check current Supabase and Next.js docs before writing version-specific code.
- Show the full SQL and RLS policies for review before they are applied. Mistakes there are security bugs.

## Workflow
1. Explore (plan mode, read-only): list ambiguities and conflicts, propose architecture and data model.
2. Plan: milestones with schema, RLS policies and acceptance criteria. Save the approved version as `PLAN.md`.
3. Code: one milestone per session. `/clear` before the next.
4. Commit: one branch and one commit or PR per milestone. Deploy a Vercel preview to test on real phones.

Build the thin vertical slice in docs/scope.md first.
Update the scope files when a decision changes, so the files and the code do not drift apart.

## First prompt for Explore
Read docs/scope.md, docs/constraints.md and docs/ambiguity.md. Do not write code yet.
First list any ambiguities or conflicts you find, and any PO WILL ANSWER items that block a milestone.
Then propose the architecture for Next.js, Supabase and Vercel, including how username-only login will work with Supabase Auth, the database schema, how the two-role limit, slot limits, 30-guest limit and the guest state machine are enforced in Postgres, and how account deletion and the two-week cleanup work.
Finally, propose a milestone plan where each milestone has acceptance criteria, starting with the thin vertical slice.
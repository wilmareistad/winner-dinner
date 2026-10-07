# WinnerDinner 2000: Milestone plan

Status: **APPROVED.** Milestones 0 to 5 are done and applied to the dev Supabase project.
Source rules: `docs/scope.md`, `docs/constraints.md`, `docs/ambiguity.md`. If this plan and those files disagree, stop and ask.

## Working rules for every milestone
- One milestone per session and per branch. `/clear` before the next. Do not start the next milestone.
- Full SQL and RLS policies are shown for review **before** they are applied. Migrations are applied only after approval.
- Every rule touched by the milestone gets a test, written together with the code.
- All writes go through `SECURITY DEFINER` functions with a fixed `search_path` that first lock the dinner row (`SELECT ... FOR UPDATE`). Clients get no direct INSERT/UPDATE/DELETE on business tables.
- Everything is keyed by user id (uuid), never by username.
- Only the publishable key reaches the browser. The app uses no service-role key (account deletion is a database function, see M5).
- Check current Supabase and Next.js docs before writing version-specific code.

## Data model (target, built up over the milestones)

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | One row per user | `id` (= `auth.users.id`, cascade), `username` (citext, unique), `display_name`, `emoji` |
| `dinners` | A request | `id`, `owner_id`, `invite_token` (random), `link_enabled`, `main_title`, `main_url`, `main_description`, `starts_at` (timestamptz), `short_description`, `invitation_summary`, `cost_split` |
| `dinner_costs` | Total cost, only readable while split is on | `dinner_id`, `total_sek` |
| `participants` | Guest status per dinner. Owner has an `accepted` row | `dinner_id`, `user_id`, `status` (invited, accepted, declined, kicked) |
| `features` | A task category with slots | `id`, `dinner_id`, `type`, `label`, `slots`, `recipe_title`, `recipe_url`. The colour comes from `type` in the UI (no column) |
| `roles` | A claimed slot | `feature_id`, `dinner_id`, `user_id`, unique (`feature_id`, `user_id`) |
| `notices` | Home-page messages, independent of the dinner | `id`, `user_id`, `text`, `created_at` |

## Milestone 0: Foundations and spike
Goal: remove the technical risks before any business logic.

Scope
- Next.js (JavaScript) app, `@supabase/ssr` client setup, lint, Vitest.
- Supabase CLI (via `npx`) against the dev project through the session pooler. Migrations folder. SQL/RLS tests with Vitest + `pg` in rolled-back transactions.
- Username login: sign-up and login with a hidden email derived from the lowercase username, email confirmation disabled, `profiles` row created for each new auth user (trigger).
- Test harness that opens several parallel database connections (Vitest + `pg`) for race tests.
- Vercel preview deploy.

Acceptance criteria
- A user can sign up with a username and password, log out and log in again.
- Duplicate username (also with different capitalisation) gives "Username is not available".
- Wrong username or wrong password gives the same generic error.
- No email is sent or required.
- A parallel-connection test runs in CI/locally and can show two transactions racing on one row.
- The preview URL loads on a phone and login works there.
- No secret is in git (`.env*` ignored, `.env.example` committed).

Tests: username uniqueness (case-insensitive), generic login error, profile created on sign-up.

## Milestone 1: Thin vertical slice
Goal: the path in `docs/scope.md` ("Thin vertical slice"), with the core database rules and locking already in place.

Scope
- Tables: `dinners`, `participants`, `features`, `roles`, plus RLS and the functions below.
- Functions: `create_dinner`, `join_by_token`, `set_answer`, `add_feature`, `claim_role`, `unclaim_role`.
- Pages: login/sign-up, invite landing (minimal), home (my dinners, invited dinners, create), request page for User 1 and for guests.
- Read-only check (`now() >= starts_at`) in every mutating function from the start.
- Host as a feature with 1 slot, taken by User 1 on creation.

Acceptance criteria (the slice)
1. User 1 signs up and logs in.
2. User 1 creates a dinner (main course, date, time) and gets an invite link.
3. User 1 adds one feature with 2 slots.
4. A guest opens the link while logged out, logs in, and returns to the request (relative path only).
5. The guest accepts and sees the list of accepted guests (username and emoji).
6. The guest claims a slot. The two-role limit and "full feature" are enforced by the database.

Tests (all in SQL/Vitest, not only in the UI)
- Third role claim is rejected. Host counts as one role.
- Claiming a full feature is rejected.
- Last slot claimed by two users at once: exactly one succeeds, the other gets a clear message.
- Same user claims in two tabs at once: the third role fails.
- One role per feature per user.
- Only `accepted` participants (and User 1) can claim.
- Claim, unclaim and answer change after the dinner time are rejected.
- A user who is not a participant cannot read the dinner, its features or its roles (RLS). Direct INSERT/UPDATE from the client is denied.
- Invalid, unknown or disabled token gives "link not valid" and leaks no data.
- Dinner date cannot be set in the past.

## Milestone 2: Request management
Scope: `update_dinner`, `remove_feature`, `set_slots`, `set_link_enabled`; full list of feature types; Alcohol modal with `age_confirmed`; recipe title/URL on extra courses; invitation summary; main course editable by User 1 only; colour-coded categories; Entertainment label; Host unselect/take by a guest.

Acceptance criteria
- Only Appetizer, Dessert and Snack can be added several times. Other types once. One main course per request.
- Alcohol is added only when `age_confirmed = true`. Answering "No" in the modal adds nothing.
- Lowering slots below the filled count is blocked with a message that shows the count.
- Removing a feature with roles asks for confirmation, removes its roles and creates a notice for each affected user (notice table is created here, the home-page list is built in M5).
- Disabling the link blocks new joins. Existing participants keep access.
- Only User 1 can edit the dinner. A guest, including `invited`, cannot change the main recipe.
- Another user can take Host when User 1 unselects it. Only one Host per dinner.

Tests: each rule above, plus "User 1 removes a feature while someone is claiming it" and "User 1 lowers slots while someone is claiming".

## Milestone 3: Guest management
Scope: decline and change answer, hidden declined guests, kick, re-add, 30-guest limit.

Acceptance criteria
- Declining frees all roles. The declined guest is hidden from other guests, visible to User 1, and can change their answer back.
- A declined guest who opens the link lands on the request page and no new row is created.
- Kick frees roles at once. A kicked user cannot open the link or the request, and the dinner disappears from their list. No notice is sent to the kicked user.
- User 1 re-adds a kicked guest by searching among that dinner's kicked guests only. They return as `invited` with no roles.
- At most 30 `accepted` guests (User 1 not counted). Accept, decline-to-accept and re-add checks use the same function.
- User 1 cannot kick themselves. No kick after the dinner time.
- User 1 sees invited and accepted lists and counts.

Tests: the 30th and 31st guests accept at the same time; guest changes to "No" while claiming; kick while the guest is claiming; kicked user opens the link; declined guest cannot claim; roles exist only for `accepted` participants.

## Milestone 4: Cost split
Scope: `dinner_costs` table, `set_cost_split`, per-person display.

Acceptance criteria
- Per-person amount = total / (accepted guests + User 1), rounded up to whole SEK.
- Zero accepted guests: no divide-by-zero.
- Cost split off: no cost or amount is returned by any query (table, view or function) for any user, and nothing is shown. Turning split off removes the stored total.
- The amount updates when guests accept or decline. After the dinner time it cannot be changed.

Tests: RLS test that a guest and an anonymous user get no rows when split is off; E1/E2 from `docs/ambiguity.md` (600 / 4 = 150, then 200).

## Milestone 5: Profile, notices and account deletion
Scope: profile (name, emoji), change password, notices list on the home page with dismiss, account deletion, notice cleanup job.

Decision (changed during M5): account deletion is the `SECURITY DEFINER` function `delete_my_account()`, called from a server action, instead of a route with the service-role key. It takes no parameters (identity = `auth.uid()`), runs in one transaction, and the app needs no service-role key at all. See `docs/ambiguity.md`, section 4.

Acceptance criteria
- A user can edit only their own profile. Other guests see username and emoji, the name only User 1 and the user see.
- Deleting an account as a guest removes them from all dinners and frees their roles.
- Deleting an account as User 1 deletes all their dinners. Their guests get a notice. Notices survive the deletion of the dinner.
- Deleting a dinner manually also creates notices for its guests.
- Deletion is one transaction (`profiles` cascades from `auth.users`). A failure leaves no half-deleted account.
- The route deletes only the logged-in user and never reads a user id from the request body. The username can be reused afterwards and the new account inherits nothing.
- Notices disappear when dismissed or after 14 days (pg_cron).

Tests: guest deletion, owner deletion with notices, partial-failure rollback, username reuse, route rejects another user's id, cascade deletes are not blocked by the read-only check.

## Milestone 6: Lifecycle
Scope: read-only view after the dinner time, cleanup 2 weeks later with pg_cron.

Acceptance criteria
- After the dinner time every action is disabled in the UI and rejected by the database. The view stays readable.
- pg_cron deletes dinners 2 weeks after the dinner time, with features, roles, participants and the invite link in one transaction. No warning.
- A failed run is retried on the next run. Dinners stay read-only in the meantime.
- Opening a deleted dinner shows "Request not found".

Tests: read-only on each function; cleanup deletes only dinners past the cutoff; cleanup while a user views the request; cron job is registered (check `pg_cron` is available on the dev project).

## Milestone 7: Design and release check
Scope: minimalist off-white design with pastel violet and blue accents, colour-coded features with a label or icon, phone testing.

Acceptance criteria
- Text keeps sufficient contrast. Colour is never the only signal.
- Full flow works on a real phone through a Vercel preview.
- English only.
- A final run of all tests and lint passes.

## Open items
None. `docs/ambiguity.md` has no open **PO WILL ANSWER** items.

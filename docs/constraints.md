# WinnerDinner 2000: Constraints

The "rooms" of the application, inside the scope in `SCOPE.md`.
Every rule here marked **[DB]** must be enforced server-side in Postgres (constraint, trigger, or function with a lock, plus RLS), not only in the UI or JavaScript.
Every rule gets a test.

---

## 1. Permissions: who can do what?

### Actors
- **Anonymous visitor**: can see only the login/sign-up page and the invite landing page.
- **Logged-in user**: can manage their own profile, create requests, and join requests by link.
- **User 1 (per request)**: admin of that request only.
- **Guest (per request)**: has a status: `invited`, `accepted`, `declined`, `kicked`.

There are no global admin or moderator roles. User 1 on one request is an ordinary guest on another.

### Rules
- Only User 1 can: edit the request, add/remove features, change slot limits, change the main course, write the invitation summary, toggle cost split and total, enable/disable the link, kick guests, re-add kicked guests, delete the request. **[DB]**
- Only User 1 can see declined guests. **[DB / RLS]**
- Only User 1 and users currently allowed on the request can see it. Kicked users cannot see it. **[DB / RLS]**
- Guests cannot change the main recipe. **[DB]**
- A user can only remove their own role. User 1 can free someone else's roles only by kicking them or removing the feature.
- A user can only edit their own profile and delete their own account.
- Only `accepted` guests (and User 1 acting as a participant) can claim roles. **[DB]**
- If cost split is off, no cost or amount is returned by any query or shown in any UI. **[DB / RLS or view]**
- Passwords are stored hashed, never as plain text (handled by Supabase Auth).
- Email or phone is optional contact info, not used for login.

---

## 2. Data & state: relationships and where they can go wrong

### What a dinner stores
- Invite URL and whether the link is enabled
- Main course title, URL and description
- Date, time, short description, invitation summary
- User 1's username (so the correct user has admin access)
- Guests' usernames and their status
- Features that have been added, with their slot limits
- Optional title, URL and description for extra courses
- Which user has taken which role
- Whether cost is split, and the total cost if it is

### Guest state machine

| From | To | Who | Effect |
|---|---|---|---|
| (none) | `invited` | Guest, via link | Only if link enabled, request not full, not read-only, and user not kicked. |
| `invited` | `accepted` | Guest | Only if the 30-guest limit allows. |
| `invited` / `accepted` | `declined` | Guest | All roles freed. Hidden from other guests. Visible to User 1. |
| `declined` | `accepted` | Guest | Allowed (declined is not removal). Subject to the 30-guest limit. |
| any | `kicked` | User 1 | All roles freed. Blocked from link and request. |
| `kicked` | `accepted` or `invited` | User 1 only, by username search | Guest cannot re-enter by themselves, even with the link. |

### Invariants **[DB]**
- Username is unique. Duplicate gives the error "Username is not available".
- A user holds at most **two roles per request**. Host counts as one.
- A feature cannot have more filled slots than its slot limit. A full feature cannot be claimed.
- If two people claim the last slot at the same time, exactly one succeeds and the other gets a clear message.
- If User 1 lowers a slot limit below the number already filled, the change is blocked with a message.
- A request has at most one main course.
- A request has at most 30 guests. Further attempts get a clear message.
- Only one person holds Host per request.
- A role exists only while its holder is `accepted` (or is User 1). Leaving accepted status frees the roles in the same transaction.
- Removing a feature removes its roles, and the affected users get a home-page notice.
- Per-person cost = total cost divided by the number of accepted attendees, including User 1. Display only, never stored as a payment.

### Lifecycle
- **Read-only:** after the dinner date has passed, the request is read-only. No claims, unclaims, answer changes, edits or kicks.
- **Cleanup:** the request and its data are deleted 2 weeks after the dinner date. No warning is sent.
- **Account deletion:**
  - As a guest: the user is removed from all requests and their roles are freed.
  - As User 1: every request they created is deleted too, and guests get a notice on their home page.
  - Notices must survive the deletion of the request they refer to (they are stored independently of the request).
- Deleting a request removes features, roles, guest rows and the invite link in one transaction (cascade).

### What could go wrong (to cover with tests)
- Two concurrent claims on the last slot.
- A user claims two roles in two browser tabs at the same time (third claim must fail).
- A guest changes to "No" while claiming a role at the same moment.
- User 1 removes a feature while someone is claiming it.
- User 1 lowers a slot limit while someone is claiming.
- User 1 kicks a guest while that guest is claiming.
- The 30th and 31st guests accept at the same time.
- Cleanup job runs while a user is viewing the request.
- A deleted user's username: can it be reused? (see `AMBIGUITY.md`)

---

## 3. External dependencies

There are no third-party payment or messaging services in this version. The dependencies are the platform services.

- **Supabase Auth.** Built around email. Username login needs a workaround (for example a hidden email derived from the username). The plan must state which approach is used. Auth rate limits on sign-up and login apply.
- **Supabase Postgres.** Source of truth for all business rules. `pg_cron` is needed for the two-week cleanup. Check it is available on the dev project's plan.
- **Account deletion** needs elevated rights, so it runs in server-side code only. Nothing with the service-role key reaches the browser.
  - If the auth user is deleted but the data cascade fails (or the reverse), the state must be recoverable. Decide which side is deleted first and what happens on partial failure.
  - Which wins if the auth user and the profile row disagree? Proposal: the auth user is the identity, and orphaned profile rows are cleaned up.
- **Vercel.** Hosting and preview deploys. No business logic that depends on a single serverless invocation finishing.
- **Environments.** A dev Supabase project only. The agent never receives production keys or the service-role key.

---

## 4. Performance & scale

- Limits are small by design: 30 guests per request, slot counts are small, dinners are short-lived.
- Expected load: a handful of simultaneous users per request. The interesting case is **concurrency on one request**, not volume. 10 users clicking vs 30 users clicking the same slot must behave the same way.
- Correctness comes from database locks or atomic functions, not from client-side checks.
- Views that list "dinners I have created / been invited to" must be indexed so they stay fast as old requests accumulate (cleanup keeps this bounded).
- Live updates of slot state: see `AMBIGUITY.md` (refresh vs realtime). A stale screen must never produce a wrong result, only a clear error on the server's answer.

---

## 5. Failure modes: what happens when the happy path fails?

| Situation | Required behavior |
|---|---|
| Username already taken at sign-up | Error "Username is not available". |
| Wrong username or password | Generic error that does not reveal which part was wrong. |
| Last slot taken by someone else first | Clear message: the slot was just filled. Screen refreshes. |
| User tries a third role | Rejected with a clear message. |
| 31st guest tries to join | Clear message that the request is full. |
| User 1 lowers slots below filled count | Blocked with a message showing how many are filled. |
| User 1 removes a feature that has roles | Confirmation first. Roles removed, affected users get a home-page notice. |
| Adds Alcohol but answers "No" in the modal | Feature is not added. No partial state. |
| Opens link that is disabled, unknown, or for a deleted request | Clear "link not valid" page. No data leaked. |
| Kicked or blocked user opens the link | Clear message that they cannot join. No request data shown. |
| Opens a request after the dinner date | Read-only view. All actions disabled, and rejected by the database if attempted. |
| Opens a request after deletion | "Request not found". |
| Not logged in when opening the link | Login or sign-up, then return to the request. |
| Session expires mid-action | The action fails safely. User logs in and returns to the same request. |
| Network failure while claiming | The action is either fully applied or not at all. UI shows the real state after retry. |
| Account deletion fails part-way | No half-deleted accounts. See external dependencies. |
| Cleanup job fails | Retried on next run. Requests past the date stay read-only in the meantime. |
| Cost split on but zero accepted attendees | No divide-by-zero. Show the total only, or nothing (see `AMBIGUITY.md`). |
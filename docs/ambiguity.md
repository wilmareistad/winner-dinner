# WinnerDinner 2000: Ambiguity

The unwritten rules. Every question has one of these tags:

- **DECIDED**: answered, and the agent must follow it.
- **OUT OF SCOPE (v1)**: the gap was seen and deliberately not filled. The agent must not build it or guess.
- **PO WILL ANSWER**: still open. The agent must not guess. It lists the question in the plan and asks. No items are open at the moment.

---

## 1. Decision log (conflicts already resolved)

| # | Question | Answer |
|---|---|---|
| 1 | Declining vs. changing your answer | **DECIDED.** Declining does not delete the guest from the request. A declined guest is hidden from other guests. User 1 can see who declined. The guest can change their answer back. |
| 2 | Invite link vs. re-adding | **DECIDED.** Kicked users are blocked from the link until User 1 re-adds them. |
| 3 | How does User 1 re-add someone? | **DECIDED.** If a guest is kicked, User 1 searches by username to re-add them. Declined guests are not deleted, so they do not need re-adding. |
| 4 | Account deletion | **DECIDED.** Requests created by a deleted user are deleted too. Guests are notified on their home page. |
| 5 | Duplicate lines | **DECIDED.** "Guests cannot change the main recipe" stays in **Must** and is removed from **Won't**. The unfinished line "guests can only" is removed from Won't. |
| 6 | Warning before the two-week deletion | **DECIDED.** No warning. It is 2 weeks after the dinner, so the invitation is no longer needed. |
| 7 | Who counts toward the 30-guest limit | **DECIDED.** Only `accepted` guests. `invited` and `declined` do not count, so a shared link cannot fill the request. User 1 is not counted. |
| 8 | Status of a re-added kicked guest | **DECIDED.** `invited`, with no roles. They must accept again. |
| 9 | Who can change the main recipe | **DECIDED.** Only User 1. No guest, in any status, can change it. |
| 10 | Password reset | **OUT OF SCOPE (v1).** There is no reset. A forgotten password means a lost account. A logged-in user can change their password. |
| 11 | Live updates of slot state | **DECIDED.** No realtime in v1. The screen refreshes on actions and page load. |

---

## 2. Example mapping

### Story A: "A guest can take a role on a feature"

**Rules**
- R1. Only accepted guests (and User 1) can claim.
- R2. A feature cannot be claimed when all slots are filled.
- R3. A user holds at most two roles per request. Host counts as one.
- R4. The request must not be read-only.
- R5. A user can remove their own role at any time (until read-only).

**Examples**
- E1 (R2): Dessert has 2 slots. Anna and Ben hold them. Carl clicks Dessert and gets "This feature is full".
- E2 (R2, concurrency): Dessert has 1 slot left. Carl and Dina click at the same moment. One gets the slot, the other gets "Someone just took the last slot".
- E3 (R3): Anna holds Cleanup and Snack. She clicks Soft drinks and gets "You can hold at most two roles".
- E4 (R3): User 1 is Host by default (1 role). They take Grocery shopping (2 roles). A third claim is rejected until they drop one.
- E5 (R1): A declined guest cannot claim. They must first change their answer to "Yes".
- E6 (R4): The dinner was yesterday. Claim buttons are disabled, and a direct request is rejected.

**Questions (red cards)**
- Q-A1. Can a guest in `invited` status (not yet answered) see features, without being able to claim? **DECIDED.** Yes, read-only view.
- Q-A2. Can one user hold two roles on the *same* feature (two slots of Dessert)? **DECIDED.** No, one role per feature per user. Two different features (two Desserts) are two roles.
- Q-A3. Is Main course a feature with slots (several people cook it)? **DECIDED.** yes, same mechanics as other features, with one main course per request.

### Story B: "User 1 can kick a guest"

**Rules**
- R1. Only User 1 can kick.
- R2. The kicked guest's roles are freed immediately.
- R3. A kicked guest cannot use the link to come back.
- R4. User 1 can re-add a kicked guest by username.

**Examples**
- E1: Ben holds Dessert. User 1 kicks Ben. The Dessert slot is free. Ben sees "You can't join this request" on the link.
- E2: User 1 searches "ben_k", finds Ben, and re-adds him. Ben returns as `invited` with no roles.

**Questions**
- Q-B1. Can User 1 kick themselves, or kick a guest after the dinner date? **DECIDED:** no to both (read-only after the date, and User 1 is not a guest).
- Q-B2. Is the kicked user told? **OUT OF SCOPE (v1).** No notice is sent to a kicked user.
- Q-B3. Does a re-added guest get their old roles back? **DECIDED:** no, they return with no roles.
- Q-B4. Does a kicked user still see the request in "Dinners I have been invited to"? **DECIDED.** no, it disappears from their list.

### Story C: "User 1 can turn cost split on"

**Rules**
- R1. Per-person amount = total / number of accepted attendees including User 1.
- R2. Display only.
- R3. If off, no amount appears anywhere.

**Examples**
- E1: Total 600, User 1 plus 3 accepted guests = 4 people. Each sees 150.
- E2: A guest declines. The count drops to 3 and the amount becomes 200 for everyone.

**Questions**
- Q-C1. Currency and rounding (600 / 7)? **DECIDED.** a single currency (SEK), per-person amount rounded up to the next whole krona.
- Q-C2. If User 1 is not attending, do they count? **DECIDED.** User 1 always counts, as the scope says.

---

## 3. "What breaks this?" by core mechanic

### Mechanic: claiming roles and slots

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Can User 1 assign a role to someone else? | **OUT OF SCOPE (v1).** Users only claim for themselves. |
| Actor | Who holds Host, and can a guest take Host if User 1 unselects it? | **DECIDED.** yes, Host is a single-slot role anyone accepted can take. |
| Time | Claim arrives after the date has passed | **DECIDED.** Rejected, request is read-only. |
| State | Guest changes to "No" while their claim is processing | **DECIDED.** Both are serialized in the database. The final state has no roles for a non-accepted guest. |
| State | User 1 lowers slots below filled | **DECIDED.** Blocked with a message. |
| State | User 1 removes a feature with filled roles | **DECIDED.** Roles removed, users get a home-page notice. |

### Mechanic: invite link and guest limit

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Who counts toward the 30 limit? | **DECIDED.** Only `accepted` guests (see decision 7). |
| Actor | Can a link be shared so strangers join? | **DECIDED.** Yes. Anyone with the link can join, unless blocked. The link can be disabled by User 1. |
| Time | Link opened after the date or after deletion | **DECIDED.** Clear "link not valid" or read-only view. |
| State | Declined user opens the link | **DECIDED.** No new row is created. They keep the existing guest row and land on the request page, where they can change their answer (see decision 1). |
| State | Link is disabled, and existing guests? | **DECIDED.** existing guests keep access, only new joins are blocked. |

### Mechanic: cost split

| Dimension | Question | Tag |
|---|---|---|
| Money | Discounts, tips, unequal shares, payments | **OUT OF SCOPE (v1).** Equal split only, display only. |
| Money | Total changed after people saw an amount | **DECIDED.** The amount updates live. No history is kept. |
| Actor | Who counts: accepted only, or also invited | **DECIDED.** Accepted attendees plus User 1. |
| Time | Cost changed after the dinner date | **DECIDED.** Not allowed (read-only). |
| State | Zero accepted guests | **DECIDED.** Accepted guests = 0. User 1 still counts, so the divisor is at least 1. User 1 always sees the invited and accepted lists and counts. If cost split is off, nothing about cost is shown. |

### Mechanic: account deletion

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Deleted user was User 1 | **DECIDED.** Their requests are deleted, guests get a home-page notice. |
| Actor | Deleted user was a guest | **DECIDED.** Removed from requests, roles freed. |
| Time | Is deletion immediate or delayed | **DECIDED.** immediate, with a confirmation step. |
| State | Can the username be reused after deletion | **DECIDED.** yes. |
| State | How long do notices stay on the home page | **DECIDED.** until dismissed, or 14 days. |

### Mechanic: alcohol age check

| Dimension | Question | Tag |
|---|---|---|
| Actor | Is age checked for guests | **OUT OF SCOPE (v1).** Only User 1's confirmation. |
| Time | A guest under 18 joins later via the link | **OUT OF SCOPE (v1).** Not checked. |
| State | User 1 answers "No" | **DECIDED.** Feature is not added. |
| State | Modal shown again if Alcohol is removed and re-added | **DECIDED.** Yes, every time it is added. |

---

## 4. Technical decisions

All **DECIDED**. Chosen to fit the rules above. Change them here first if they turn out wrong.

| Topic | Decision |
|---|---|
| Username login | Hidden email address derived from the lowercase username. There is no email verification at all: confirmation is disabled in Supabase, and no email is ever sent or shown to the user. |
| Username rules | Case-insensitive unique (`citext`), 3 to 20 characters, letters, digits and underscore. Cannot be changed after sign-up. Reusable after the account is deleted. Duplicate gives "Username is not available". |
| Password | Minimum 8 characters. No reset (decision 10). |
| Identity | User id (uuid) everywhere. Never the username. |
| Writes | Only through `SECURITY DEFINER` functions with fixed `search_path`. Every function that changes a request takes a row lock on the dinner first, which serializes claims, answers, kicks, feature changes, slot changes and deletes. |
| Read-only and cascade | The read-only check does not block cascade deletes from account deletion or cleanup. |
| Time | Dinner date and time stored as `timestamptz`, entered in Europe/Stockholm. Read-only starts at the dinner time. Cleanup deletes 2 weeks after it. The date cannot be set in the past. |
| Cost | Total in a separate table. RLS returns it only while cost split is on. Turning split off removes the stored total. |
| Feature model | Main course and Host are features with slots (Host: 1 slot, Main course: one per request). Appetizer, Dessert and Snack can be added several times. Other types once per request. Slots: 1 to 30 per feature. |
| Entertainment | One feature with an optional label (board games, console games, karaoke, other). "Other" takes free text. |
| Alcohol | The server function requires `age_confirmed = true` when adding Alcohol. |
| User 1 as participant | Stored as an `accepted` participant row. Not counted in the 30 guests, counted in the cost split and in "who is coming". |
| Re-add search | Username search only among the kicked guests of that request. No global user search. |
| Profile visibility | Other guests see username and emoji. The name is visible to User 1 and to the user themselves only. |
| Invite link | Random token with high entropy, separate from the request id. The landing page for anonymous visitors shows only "You have been invited" and the login/sign-up form. After login the user returns by a relative path only. |
| Notices | Keyed by user id, with a text copy of the message. Created for: feature removed, request deleted by its creator, request deleted because the creator deleted their account. Removed when dismissed or after 14 days. |
| Accessibility | Feature colours must not be the only signal (also use a label or icon), and text must keep sufficient contrast on off-white. |
| Tests | Vitest for everything. SQL/RLS tests use `pg` inside rolled-back transactions. Concurrency tests use several parallel database connections. |

---

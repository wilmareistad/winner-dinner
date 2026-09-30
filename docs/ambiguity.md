# WinnerDinner 2000: Ambiguity

The unwritten rules. Every question has one of three tags:

- **DECIDED**: answered, and the agent must follow it.
- **OUT OF SCOPE (v1)**: the gap was seen and deliberately not filled. The agent must not build it or guess.
- **PO WILL ANSWER**: still open. The agent must not guess. It lists the question in the plan and asks, or implements the stated *proposal* behind a clearly marked seam that is easy to change.

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

### Consequences of these answers that the agent must handle
- Earlier wording "declined or kicked guests lose access to the request page" is replaced by the state machine in `CONSTRAINTS.md`.
- Answers 1 and 2 pull in slightly different directions for `declined`. Q1 below states how they are reconciled.

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
- Q-A1. Can a guest in `invited` status (not yet answered) see features, without being able to claim? **PO WILL ANSWER.** Proposal: yes, read-only view.
- Q-A2. Can one user hold two roles on the *same* feature (two slots of Dessert)? **PO WILL ANSWER.** Proposal: no, one role per feature per user.
- Q-A3. Is Main course a feature with slots (several people cook it)? **PO WILL ANSWER.** Proposal: yes, same mechanics as other features, with one main course per request.

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
- Q-B4. Does a kicked user still see the request in "Dinners I have been invited to"? **PO WILL ANSWER.** Proposal: no, it disappears from their list.

### Story C: "User 1 can turn cost split on"

**Rules**
- R1. Per-person amount = total / number of accepted attendees including User 1.
- R2. Display only.
- R3. If off, no amount appears anywhere.

**Examples**
- E1: Total 600, User 1 plus 3 accepted guests = 4 people. Each sees 150.
- E2: A guest declines. The count drops to 3 and the amount becomes 200 for everyone.

**Questions**
- Q-C1. Currency and rounding (600 / 7)? **PO WILL ANSWER.** Proposal: a single currency label set once (SEK), rounded up to the next whole unit or to 2 decimals.
- Q-C2. If User 1 is not attending, do they count? **PO WILL ANSWER.** Proposal: User 1 always counts, as the scope says.

---

## 3. "What breaks this?" by core mechanic

### Mechanic: claiming roles and slots

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Can User 1 assign a role to someone else? | **OUT OF SCOPE (v1).** Users only claim for themselves. |
| Actor | Who holds Host, and can a guest take Host if User 1 unselects it? | **PO WILL ANSWER.** Proposal: yes, Host is a single-slot role anyone accepted can take. |
| Time | Claim arrives after the date has passed | **DECIDED.** Rejected, request is read-only. |
| State | Guest changes to "No" while their claim is processing | **DECIDED.** Both are serialized in the database. The final state has no roles for a non-accepted guest. |
| State | User 1 lowers slots below filled | **DECIDED.** Blocked with a message. |
| State | User 1 removes a feature with filled roles | **DECIDED.** Roles removed, users get a home-page notice. |

### Mechanic: invite link and guest limit

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Who counts toward the 30 limit? | **PO WILL ANSWER.** Proposal: all guests except kicked (so `invited`, `accepted`, `declined` count). |
| Actor | Can a link be shared so strangers join? | **DECIDED.** Yes. Anyone with the link can join, unless blocked. The link can be disabled by User 1. |
| Time | Link opened after the date or after deletion | **DECIDED.** Clear "link not valid" or read-only view. |
| State | Declined user opens the link | **DECIDED.** Blocked from joining anew. They keep the existing guest row (see Q1). |
| State | Link is disabled, and existing guests? | **PO WILL ANSWER.** Proposal: existing guests keep access, only new joins are blocked. |

### Mechanic: cost split

| Dimension | Question | Tag |
|---|---|---|
| Money | Discounts, tips, unequal shares, payments | **OUT OF SCOPE (v1).** Equal split only, display only. |
| Money | Total changed after people saw an amount | **DECIDED.** The amount updates live. No history is kept. |
| Actor | Who counts: accepted only, or also invited | **DECIDED.** Accepted attendees plus User 1. |
| Time | Cost changed after the dinner date | **DECIDED.** Not allowed (read-only). |
| State | Zero accepted attendees | **DECIDED.** User 1 still counts, so the divisor is at least 1. |

### Mechanic: account deletion

| Dimension | Question | Tag |
|---|---|---|
| Money | (none) | n/a |
| Actor | Deleted user was User 1 | **DECIDED.** Their requests are deleted, guests get a home-page notice. |
| Actor | Deleted user was a guest | **DECIDED.** Removed from requests, roles freed. |
| Time | Is deletion immediate or delayed | **PO WILL ANSWER.** Proposal: immediate, with a confirmation step. |
| State | Can the username be reused after deletion | **PO WILL ANSWER.** Proposal: yes. |
| State | How long do notices stay on the home page | **PO WILL ANSWER.** Proposal: until dismissed, or 14 days. |

### Mechanic: alcohol age check

| Dimension | Question | Tag |
|---|---|---|
| Actor | Is age checked for guests | **OUT OF SCOPE (v1).** Only User 1's confirmation. |
| Time | A guest under 18 joins later via the link | **OUT OF SCOPE (v1).** Not checked. |
| State | User 1 answers "No" | **DECIDED.** Feature is not added. |
| State | Modal shown again if Alcohol is removed and re-added | **DECIDED.** Yes, every time it is added. |

---

## 4. Other open questions

| # | Question | Tag |
|---|---|---|
| Q1 | A `declined` guest is "blocked from the link" (answer 2) but also "not deleted" and can change answer (answer 1). Reconciliation used in the scope: a declined guest keeps their guest row and request page access and can switch back to Yes themselves. The link only blocks people who are not currently a guest, plus kicked users. Is that right? | **PO WILL ANSWER.** |
| Q2 | Login by username: hidden-email workaround (proposal) vs real email. | **PO WILL ANSWER.** Agent proposes in Explore. |
| Q3 | Forgotten password: no reset possible without email. Accept that? | **OUT OF SCOPE (v1)** unless told otherwise. |
| Q4 | Username rules: length, allowed characters, case sensitivity. | **PO WILL ANSWER.** Proposal: 3 to 20 chars, letters, digits, underscore, case-insensitive unique. |
| Q5 | Time zone of the dinner date and the exact moment it becomes read-only. | **PO WILL ANSWER.** Proposal: stored with date and time, read-only at the end of the dinner day in the dinner's time zone. |
| Q6 | Can the date or time be changed after guests have accepted, and are guests told? | **PO WILL ANSWER.** Proposal: User 1 can change it, no notice in v1. |
| Q7 | Do guests see live slot updates, or only on refresh? | **PO WILL ANSWER.** Proposal: refresh and clear server errors in v1, realtime later. |
| Q8 | Does "Entertainment" have options as sub-choices with their own slots, or one feature with a label? | **PO WILL ANSWER.** Proposal: one feature with a chosen option label. |
| Q9 | Who sees "Dinners I have been invited to" for declined requests? | **PO WILL ANSWER.** Proposal: shown, marked as declined. |
| Q10 | Are notices (removed feature, deleted request) only on the home page? | **DECIDED.** Yes, home page only. |
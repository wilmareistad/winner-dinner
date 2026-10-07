# WinnerDinner 2000: Scope

Source of truth for what to build and what NOT to build.
Companion files: `constraints.md` (the "rooms" of the app) and `ambiguity.md` (unwritten rules, decisions).
If code and these files disagree, stop and ask. Update the files when decisions change.

## Project concept

A social dinner app that spreads the work of a dinner between friends. User 1 creates a dinner request and invites friends. Everyone can then pick a role, such as host, cook or buyer, so the work is shared. User 1 decides which features are available, how many people can join each feature, and whether the cost is split.

## Terms

| Term | Meaning |
|---|---|
| **User 1** | The requester. Creates the request and has admin rights on it (per request: the same person can be User 1 on one dinner and a guest on another). |
| **Guest** | A user who joined a request through the invite link. Has a status on that request (see below). |
| **Feature** | A task category on a request (e.g. Dessert) with a limit on how many people can take it. |
| **Slot** | One place in a feature. |
| **Role** | A user's claim on a feature. One role fills one slot. |

### Guest statuses (per request)

| Status | Meaning |
|---|---|
| `invited` | Opened the link and logged in, has not answered yet. |
| `accepted` | Coming. Visible to other guests. Can claim roles. |
| `declined` | Not coming. Stays on the request but is hidden from other guests. Visible to User 1. Holds no roles. |
| `kicked` | Removed by User 1. Holds no roles. Blocked from the link and the request page until User 1 re-adds them. |

## Tech stack

- Language: JavaScript (Next.js)
- Database and authentication: Supabase
- Hosting: Vercel
- Language of the website: English.

## Design

Minimalist. Main colours are off-white with soft pastel violet and blue accents. Feature categories are colour-coded within this palette.

## In scope

### Must

- Every user can create a profile with a unique username and a password.
- Users can add their name and an emoji.
- Users can delete their own account.
- User 1 can create a dinner request with a date, a time, and one main course or recipe.
- User 1 can invite guests through a unique link.
- A request has a maximum of 30 accepted guests (User 1 not included). Only `accepted` guests count.
- Guests can answer whether they can come or not.
- There is a list of who is coming (accepted guests), showing username and emoji.
- User 1 can add and remove features on the request.
- User 1 sets how many users can be assigned to each feature (slots).
- Every user, including User 1, can hold a maximum of two roles per request. Host counts as one.
- Each feature shows a checkbox per slot. When someone checks it, it fills with their name and emoji.
- Each feature shows how many slots are filled and when it is full.
- Users can remove their own role again.
- Guests can see the date of the dinner.
- There is an admin page for User 1 and a separate guest page for every request.
- Only User 1 can delete a request they created.
- Guests (in any status, including `invited`) cannot change the main recipe.
- If cost split is off, no cost or amount is shown anywhere.
- Users see in-app notices on their home page when something affects them: a feature they held was removed, or a request they were on was deleted (by its creator, or because the creator deleted their account). *(Added: required by the constraints, see Out of scope for what this is not.)*

### Should

- Feature categories are colour-coded.
- User 1 can kick guests from the request. Their roles become free again.
- User 1 can re-add a kicked guest by searching their username.
- User 1 can see which guests have declined.
- Guests can change their answer. Changing to "No" frees their roles. Declining does not remove them from the request; they are only hidden from other guests.
- User 1 can change the main course or recipe.
- User 1 can add extra courses (appetizer, dessert, snack) as features. There can be several of the same type, and each can have an optional recipe (title and URL).
- User 1 can write an invitation summary that guests see on the request page.
- User 1 can turn cost split on or off. It is shown as a per-person amount.
- User 1 can disable and enable the invite link. *(Added: implied by "whether the link is enabled" in the data model. Remove if not wanted.)*

### Could (do not build unless asked)

- Guests can request extra features, and User 1 approves them.
- A chat on the request page.

### Won't (Won't be created)
- Real payments and in-app payments (the app only shows the split amount)
- Push notifications, email or SMS notifications, and native mobile apps
- Recurring dinners
- Multiple languages (English only)
- Guest-requested features and chat (see Could)
- Warning guests before a request is deleted 2 weeks after the dinner
- Password reset by email (a forgotten password means a lost account)
- Age verification of guests

## Available feature types

- Appetizers (several allowed, optional recipe)
- Main course (only one per request)
- Dessert (several allowed, optional recipe)
- Snack (several allowed, optional recipe)
- Alcohol (see age check below)
- Soft drinks
- Grocery shopping (buyer)
- Cleanup
- Entertainment (a subcategory with options like board games, console games, karaoke and other)
- **Host** is a fixed role with one slot. User 1 has it by default and can unselect it to take other roles instead.

Only Appetizer, Dessert and Snack can be added several times. All other types (including Entertainment, Alcohol, Soft drinks, Grocery shopping and Cleanup) can be added once per request. Details in `ambiguity.md`, section 4.

### Alcohol age check

When User 1 adds Alcohol, a modal asks: "Is everyone invited over 18?"
- If User 1 confirms, the feature is added.
- If not, the feature is not added.

The app does not verify ages. It is a confirmation by User 1 only.

## Thin vertical slice (build this path first)

One path that touches every layer end to end:

1. User 1 signs up with username and password, and logs in.
2. User 1 creates a dinner request (main course, date, time) and gets an invite link.
3. User 1 adds one feature with 2 slots.
4. A guest opens the link, logs in, and is returned to the request.
5. The guest accepts and sees the list of accepted guests.
6. The guest claims a slot, and the two-role limit and "full feature" rule are enforced in the database.

Everything else (extra features, cost split, kick, re-add, cleanup, design pass) is added on top of this slice.

## Pages

- Login and sign-up page
- Invite landing page (for people who are not logged in yet)
- Home / user page:
  - My user info
  - Change password
  - Delete account
  - Dinners I have created
  - Dinners I have been invited to
  - Notices
  - Create new dinner request
- Current request, User 1 view (admin)
- Current request, Guest view

## User flows

### User 1
1. Logs in, or creates a profile.
2. Opens the Create new dinner request page and enters the main course title, description and possible recipe URL.
3. Adds a date, a time, and possibly a short description and an invitation summary.
4. Adds features from the list and sets the maximum number of people for each. Adding Alcohol triggers the age modal.
5. Chooses whether to split the cost and, if so, enters the total.
6. Picks their own roles. They are Host by default and can unselect it to choose other roles, with a maximum of two.
7. Shares the invite link.

### Guest
1. Opens the invite link and logs in or creates a profile. After login they return to the request.
2. Accepts or declines.
3. After accepting, sees the other people who accepted, with username and emoji.
4. Sees all features and ticks a checkbox where they want to help. The box is then filled with their name and emoji.
5. Sees for each feature how many slots exist and whether they are all filled.

## Assumptions (made while structuring this file, please confirm)

- Only `accepted` guests can claim roles (follows from the guest flow).
- Only `accepted` guests appear in the "who is coming" list shown to guests.
- A `declined` guest keeps access to the request page so they can change their answer back. *(This reconciles "declined are not deleted" with "blocked from the link until re-added". See `ambiguity.md`, decision 1.)*
- "Host" is one person per request.
- User 1 is stored as an `accepted` participant on their own request. They are not a "guest" for the 30-guest limit, but they appear in "who is coming" and count in the cost split.

"use client";

import { useActionState, useState } from "react";
import { MAX_GUESTS, personLabel } from "@/lib/dinners";
import { kickGuest, readdGuest } from "../actions";

const GROUPS = [
  { status: "accepted", title: "Coming" },
  { status: "invited", title: "Not answered" },
  { status: "declined", title: "Not coming" },
];

// User 1 only: every guest by status with counts, kick, and re-add of kicked
// guests. The database checks all of it again.
export default function GuestManager({ dinnerId, people, readOnly }) {
  const guests = people.filter((p) => !p.is_owner);
  const kicked = guests.filter((p) => p.status === "kicked");

  return (
    <section className="stack">
      <h2>Guests</h2>
      <p className="muted">
        {guests.filter((p) => p.status === "accepted").length} of {MAX_GUESTS} places taken.
        You are not counted.
      </p>
      {GROUPS.map(({ status, title }) => {
        const list = guests.filter((p) => p.status === status);
        return (
          <div key={status} className="card stack">
            <h3>
              {title} ({list.length})
            </h3>
            {list.length === 0 ? (
              <p className="muted">Nobody.</p>
            ) : (
              <ul className="people">
                {list.map((p) => (
                  <GuestRow key={p.user_id} dinnerId={dinnerId} person={p} readOnly={readOnly} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {!readOnly && <ReaddForm dinnerId={dinnerId} kicked={kicked} />}
    </section>
  );
}

function GuestRow({ dinnerId, person, readOnly }) {
  const [state, formAction, pending] = useActionState(kickGuest, {});
  const [asked, setAsked] = useState(false);

  return (
    <li className="stack">
      <div className="row guest-row">
        <span className="grow">
          {personLabel(person)}
          {person.display_name && <span className="muted"> · {person.display_name}</span>}
        </span>
        {!readOnly && !asked && (
          <button type="button" onClick={() => setAsked(true)}>
            Remove
          </button>
        )}
      </div>
      {asked && (
        <form action={formAction} className="stack confirm" aria-label={`Remove ${person.username}`}>
          <input type="hidden" name="dinner_id" value={dinnerId} />
          <input type="hidden" name="user_id" value={person.user_id} />
          <p>
            Remove {person.username}? Their roles are freed and they can no longer open the request.
            You can add them back later.
          </p>
          <div className="row">
            <button type="submit" className="danger" disabled={pending}>
              Remove guest
            </button>
            <button type="button" onClick={() => setAsked(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </li>
  );
}

function ReaddForm({ dinnerId, kicked }) {
  const [state, formAction, pending] = useActionState(readdGuest, {});

  return (
    <div className="card stack">
      <h3>Removed guests ({kicked.length})</h3>
      {kicked.length > 0 && (
        <ul className="people">
          {kicked.map((p) => (
            <li key={p.user_id}>{personLabel(p)}</li>
          ))}
        </ul>
      )}
      <form action={formAction} className="row">
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <label className="grow">
          Add back by username
          <input
            name="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            defaultValue={state.error ? state.username : ""}
          />
        </label>
        <button type="submit" disabled={pending}>
          Add back
        </button>
      </form>
      <p className="muted">Only guests you removed from this request can be added back.</p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.readded && !pending && (
        <p role="status">{state.readded} is back as invited and must accept again.</p>
      )}
    </div>
  );
}

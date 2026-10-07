"use client";

import { useActionState, useState } from "react";
import { deleteDinner } from "../actions";

export default function DeleteDinner({ dinnerId }) {
  const [state, formAction, pending] = useActionState(deleteDinner, {});
  const [asked, setAsked] = useState(false);

  return (
    <section className="card stack">
      <h2>Delete request</h2>
      {asked ? (
        <form action={formAction} className="stack confirm">
          <input type="hidden" name="dinner_id" value={dinnerId} />
          <p>Delete this request for everyone? Guests get a notice. This cannot be undone.</p>
          <div className="row">
            <button type="submit" className="danger" disabled={pending}>
              Delete request
            </button>
            <button type="button" onClick={() => setAsked(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setAsked(true)}>
            Delete this request
          </button>
        </div>
      )}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}

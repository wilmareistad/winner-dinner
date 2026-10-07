"use client";

import { useActionState } from "react";
import { updateDinner } from "../actions";
import DinnerFields from "../DinnerFields";

// User 1 only. The database refuses the edit for anyone else.
export default function EditDinnerForm({ dinnerId, values, minDate }) {
  const [state, formAction, pending] = useActionState(updateDinner, {});

  return (
    <details className="card">
      <summary>Edit request</summary>
      <form action={formAction} className="stack edit-form">
        <input type="hidden" name="dinner_id" value={dinnerId} />
        {/* React resets the fields after the action. After a failed save, keep what was typed. */}
        <DinnerFields values={state.error ? state.values : values} minDate={minDate} />
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.saved && !pending && <p role="status">Saved.</p>}
        <button type="submit" className="primary" disabled={pending}>
          Save changes
        </button>
      </form>
    </details>
  );
}

"use client";

import { useActionState } from "react";
import { createDinner } from "../actions";
import DinnerFields from "../DinnerFields";

export default function NewDinnerForm({ minDate }) {
  const [state, formAction, pending] = useActionState(createDinner, {});

  return (
    <form action={formAction} className="card stack">
      <DinnerFields values={state.values} minDate={minDate} />
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="primary" disabled={pending}>
        Create request
      </button>
    </form>
  );
}

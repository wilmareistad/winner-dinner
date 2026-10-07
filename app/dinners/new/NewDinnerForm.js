"use client";

import { useActionState } from "react";
import { createDinner } from "../actions";

export default function NewDinnerForm({ minDate }) {
  const [state, formAction, pending] = useActionState(createDinner, {});
  const values = state.values ?? {};

  return (
    <form action={formAction} className="card stack">
      <label>
        Main course
        <input name="main_title" maxLength={100} required defaultValue={values.main_title ?? ""} />
      </label>
      <label>
        Description <span className="muted">(optional)</span>
        <textarea
          name="main_description"
          maxLength={1000}
          rows={3}
          defaultValue={values.main_description ?? ""}
        />
      </label>
      <label>
        Recipe link <span className="muted">(optional)</span>
        <input
          name="main_url"
          type="url"
          maxLength={500}
          placeholder="https://"
          defaultValue={values.main_url ?? ""}
        />
      </label>
      <div className="row">
        <label>
          Date
          <input name="date" type="date" min={minDate} required defaultValue={values.date ?? ""} />
        </label>
        <label>
          Time <span className="muted">(Swedish time)</span>
          <input name="time" type="time" required defaultValue={values.time ?? ""} />
        </label>
      </div>
      <label>
        Short description <span className="muted">(optional)</span>
        <input
          name="short_description"
          maxLength={200}
          defaultValue={values.short_description ?? ""}
        />
      </label>
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

"use client";

import { useActionState } from "react";
import { ADDABLE_FEATURE_TYPES, FEATURE_LABELS } from "@/lib/dinners";
import { addFeature } from "../actions";

export default function AddFeatureForm({ dinnerId }) {
  const [state, formAction, pending] = useActionState(addFeature, {});

  return (
    <form action={formAction} className="card stack">
      <h3>Add a feature</h3>
      <input type="hidden" name="dinner_id" value={dinnerId} />
      <div className="row">
        <label>
          Feature
          <select name="type" required defaultValue="dessert">
            {ADDABLE_FEATURE_TYPES.map((type) => (
              <option key={type} value={type}>
                {FEATURE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          People
          <input name="slots" type="number" min={1} max={30} required defaultValue={2} />
        </label>
      </div>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Add feature
      </button>
    </form>
  );
}

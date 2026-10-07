"use client";

import { useActionState, useRef, useState } from "react";
import {
  ADDABLE_FEATURE_TYPES,
  ENTERTAINMENT_OPTIONS,
  FEATURE_ICONS,
  FEATURE_LABELS,
  REPEATABLE_FEATURE_TYPES,
} from "@/lib/dinners";
import { addFeature } from "../actions";

// existingTypes hides types that can only be added once and are already there.
// The database checks it again, so a stale list only gives a clear error.
export default function AddFeatureForm({ dinnerId, existingTypes }) {
  const [state, formAction, pending] = useActionState(addFeature, {});
  const available = ADDABLE_FEATURE_TYPES.filter(
    (type) => REPEATABLE_FEATURE_TYPES.includes(type) || !existingTypes.includes(type)
  );
  const [type, setType] = useState(available.includes("dessert") ? "dessert" : available[0]);
  const [label, setLabel] = useState("");
  const formRef = useRef(null);
  const ageConfirmedRef = useRef(null);
  const dialogRef = useRef(null);
  const selected = available.includes(type) ? type : available[0];

  if (available.length === 0) return null;

  // Alcohol: ask "Is everyone invited over 18?" every time before sending.
  function onSubmit(event) {
    if (selected === "alcohol" && ageConfirmedRef.current.value !== "true") {
      event.preventDefault();
      dialogRef.current.showModal();
    }
  }

  function answerAge(yes) {
    dialogRef.current.close();
    if (!yes) return; // Nothing is added.
    ageConfirmedRef.current.value = "true";
    formRef.current.requestSubmit();
    ageConfirmedRef.current.value = "false";
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="card stack">
      <h3>Add a feature</h3>
      <input type="hidden" name="dinner_id" value={dinnerId} />
      <input ref={ageConfirmedRef} type="hidden" name="age_confirmed" defaultValue="false" />
      <div className="row">
        <label>
          Feature
          <select name="type" required value={selected} onChange={(e) => setType(e.target.value)}>
            {available.map((t) => (
              <option key={t} value={t}>
                {FEATURE_ICONS[t]} {FEATURE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          People
          <input name="slots" type="number" min={1} max={30} required defaultValue={2} />
        </label>
      </div>

      {REPEATABLE_FEATURE_TYPES.includes(selected) && (
        <div className="row">
          <label>
            Recipe title <span className="muted">(optional)</span>
            <input name="recipe_title" maxLength={100} />
          </label>
          <label>
            Recipe link <span className="muted">(optional)</span>
            <input name="recipe_url" type="url" maxLength={500} placeholder="https://" />
          </label>
        </div>
      )}

      {selected === "entertainment" && (
        <div className="row">
          <label>
            Kind <span className="muted">(optional)</span>
            <select name="label" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">Not set</option>
              {ENTERTAINMENT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>
          {label === "other" && (
            <label>
              What?
              <input name="label_other" maxLength={50} required />
            </label>
          )}
        </div>
      )}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Add feature
      </button>

      <dialog ref={dialogRef} aria-labelledby="age-question" className="card">
        <div className="stack">
          <p id="age-question">
            <strong>Is everyone invited over 18?</strong>
          </p>
          <p className="muted">Alcohol is only added if you answer yes.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => answerAge(true)}>
              Yes
            </button>
            <button type="button" onClick={() => answerAge(false)}>
              No
            </button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

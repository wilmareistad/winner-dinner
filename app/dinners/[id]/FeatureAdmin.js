"use client";

import { useActionState, useState } from "react";
import { removeFeature, setSlots } from "../actions";

// User 1's controls on one feature: change slots, remove. Host has neither.
// Going below the filled count is left to the database, which says how many are filled.
export default function FeatureAdmin({ dinnerId, feature, filled }) {
  const [slotsState, slotsAction, slotsPending] = useActionState(setSlots, {});
  const [removeState, removeAction, removePending] = useActionState(removeFeature, {});
  const [asked, setAsked] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  // Ask first if someone holds it, or if the database says someone just took it.
  const confirming = asked || (removeState.needsConfirm && dismissed !== removeState);

  function cancel() {
    setAsked(false);
    setDismissed(removeState);
  }

  return (
    <div className="stack feature-admin">
      <form action={slotsAction} className="row">
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <input type="hidden" name="feature_id" value={feature.id} />
        <label>
          People
          <input
            name="slots"
            type="number"
            min={1}
            max={30}
            required
            defaultValue={feature.slots}
            key={feature.slots}
          />
        </label>
        <button type="submit" disabled={slotsPending}>
          Save
        </button>
      </form>
      {slotsState.error && (
        <p className="error" role="alert">
          {slotsState.error}
        </p>
      )}

      <form action={removeAction} className="stack">
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <input type="hidden" name="feature_id" value={feature.id} />
        {confirming ? (
          <div className="stack confirm" role="alertdialog" aria-label="Confirm removal">
            <p>
              {removeState.needsConfirm
                ? removeState.error
                : `${filled === 1 ? "1 person holds" : `${filled} people hold`} this feature. Removing it also removes their roles.`}{" "}
              They get a notice.
            </p>
            <div className="row">
              <button type="submit" name="confirm" value="true" className="danger" disabled={removePending}>
                Remove anyway
              </button>
              <button type="button" onClick={cancel} disabled={removePending}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              type={filled > 0 ? "button" : "submit"}
              onClick={filled > 0 ? () => setAsked(true) : undefined}
              disabled={removePending}
            >
              Remove feature
            </button>
          </div>
        )}
        {removeState.error && !removeState.needsConfirm && (
          <p className="error" role="alert">
            {removeState.error}
          </p>
        )}
      </form>
    </div>
  );
}

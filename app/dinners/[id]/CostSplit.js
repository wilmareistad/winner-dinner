"use client";

import { useActionState } from "react";
import { setCostSplit } from "../actions";

// User 1's cost settings. The amount itself comes from the database and is only
// shown while the split is on (see CostLine).
export default function CostSplit({ dinnerId, cost }) {
  const [state, formAction, pending] = useActionState(setCostSplit, {});
  const on = Boolean(cost);

  return (
    <section className="card stack">
      <h2>Cost split</h2>
      {on && <CostLine cost={cost} />}
      <form action={formAction} className="row">
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <label>
          Total (SEK)
          <input
            name="total_sek"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000000}
            step={1}
            required
            defaultValue={state.error ? state.total : (cost?.total_sek ?? "")}
            key={cost?.total_sek ?? "off"}
          />
        </label>
        <button type="submit" name="enabled" value="true" className="primary" disabled={pending}>
          {on ? "Update total" : "Split the cost"}
        </button>
      </form>
      {on && (
        <form action={formAction}>
          <input type="hidden" name="dinner_id" value={dinnerId} />
          <button type="submit" name="enabled" value="false" disabled={pending}>
            Turn cost split off
          </button>
        </form>
      )}
      {!on && <p className="muted">Off. Guests see no cost.</p>}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}

export function CostLine({ cost }) {
  return (
    <p>
      <strong>{cost.per_person_sek} SEK per person</strong>{" "}
      <span className="muted">
        ({cost.total_sek} SEK shared by {cost.attendees}{" "}
        {cost.attendees === 1 ? "person" : "people"})
      </span>
    </p>
  );
}

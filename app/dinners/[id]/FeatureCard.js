"use client";

import { useActionState } from "react";
import { FEATURE_LABELS } from "@/lib/dinners";
import { toggleRole } from "../actions";

// One feature with a checkbox per slot. A filled slot shows the holder.
export default function FeatureCard({ dinnerId, feature, holders, canClaim, canUnclaim }) {
  const [state, formAction, pending] = useActionState(toggleRole, {});
  const filled = holders.length;
  const full = filled >= feature.slots;
  const freeSlots = Math.max(feature.slots - filled, 0);

  return (
    <article className="card stack" aria-label={FEATURE_LABELS[feature.type]}>
      <div className="feature-head">
        <h3>{FEATURE_LABELS[feature.type] ?? feature.type}</h3>
        <span className="badge">
          {full ? "Full" : "Open"} · {filled} of {feature.slots} filled
        </span>
      </div>
      <form action={formAction}>
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <input type="hidden" name="feature_id" value={feature.id} />
        <ul className="slots">
          {holders.map((holder) => (
            <li key={holder.userId}>
              <span aria-hidden="true">☑</span> {holder.label}
              {holder.isMe && <span className="muted"> (you)</span>}
              {holder.isMe && canUnclaim && (
                <button type="submit" name="intent" value="unclaim" disabled={pending}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: freeSlots }, (_, i) => (
            <li key={`free-${i}`}>
              {canClaim ? (
                <button type="submit" name="intent" value="claim" disabled={pending}>
                  <span aria-hidden="true">☐</span> Take this slot
                </button>
              ) : (
                <span className="muted">
                  <span aria-hidden="true">☐</span> Free
                </span>
              )}
            </li>
          ))}
        </ul>
      </form>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </article>
  );
}

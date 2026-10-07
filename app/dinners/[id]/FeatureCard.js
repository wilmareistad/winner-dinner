"use client";

import { useActionState } from "react";
import { FEATURE_ICONS, featureName } from "@/lib/dinners";
import { toggleRole } from "../actions";
import FeatureAdmin from "./FeatureAdmin";

// One feature with a checkbox per slot. A filled slot shows the holder.
// Colour-coded by type, always together with an icon and the name.
export default function FeatureCard({ dinnerId, feature, holders, canClaim, canUnclaim, canManage }) {
  const [state, formAction, pending] = useActionState(toggleRole, {});
  const filled = holders.length;
  const full = filled >= feature.slots;
  const freeSlots = Math.max(feature.slots - filled, 0);
  const name = featureName(feature);

  return (
    <article className={`card stack feature feature--${feature.type}`} aria-label={name}>
      <div className="feature-head">
        <h3>
          <span aria-hidden="true">{FEATURE_ICONS[feature.type]}</span> {name}
        </h3>
        <span className="badge">
          {full ? "Full" : "Open"} · {filled} of {feature.slots} filled
        </span>
      </div>
      {feature.recipe_url && (
        <p>
          <a href={feature.recipe_url} target="_blank" rel="noopener noreferrer">
            Recipe
          </a>
        </p>
      )}
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
      {canManage && feature.type !== "host" && (
        <FeatureAdmin dinnerId={dinnerId} feature={feature} filled={filled} />
      )}
    </article>
  );
}

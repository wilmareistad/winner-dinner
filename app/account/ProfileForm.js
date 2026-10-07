"use client";

import { useActionState } from "react";
import { updateProfile } from "./actions";

const EMOJI_CHOICES = ["🍝", "🍕", "🥗", "🍰", "🌮", "🍣", "🥘", "🍷", "🧁", "🍓", "🥨", "🎲"];

export default function ProfileForm({ profile }) {
  const [state, formAction, pending] = useActionState(updateProfile, {});
  const values = state.error ? state.values : profile;

  return (
    <details className="card">
      <summary>Edit profile</summary>
      <form action={formAction} className="stack edit-form">
        <label>
          Name <span className="muted">(optional, only you and request creators see it)</span>
          <input name="display_name" maxLength={50} defaultValue={values.display_name ?? ""} />
        </label>
        <label>
          Emoji <span className="muted">(optional, everyone on a dinner sees it)</span>
          <input
            name="emoji"
            maxLength={16}
            list="emoji-choices"
            placeholder="🍝"
            defaultValue={values.emoji ?? ""}
          />
          <datalist id="emoji-choices">
            {EMOJI_CHOICES.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.saved && !pending && <p role="status">Saved.</p>}
        <button type="submit" className="primary" disabled={pending}>
          Save profile
        </button>
      </form>
    </details>
  );
}

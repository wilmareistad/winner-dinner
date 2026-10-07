"use client";

import { useActionState } from "react";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth";
import { changePassword, deleteAccount } from "./actions";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, {});
  return (
    <details className="card">
      <summary>Change password</summary>
      <form action={formAction} className="stack edit-form">
        <label>
          Current password
          <input name="current_password" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password <span className="muted">(at least {PASSWORD_MIN_LENGTH} characters)</span>
          <input
            name="new_password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </label>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {state.saved && !pending && <p role="status">Password changed.</p>}
        <button type="submit" className="primary" disabled={pending}>
          Change password
        </button>
      </form>
    </details>
  );
}

export function DeleteAccountForm({ username }) {
  const [state, formAction, pending] = useActionState(deleteAccount, {});
  return (
    <details className="card">
      <summary>Delete account</summary>
      <form action={formAction} className="stack edit-form">
        <p>
          This deletes your account at once. Requests you created are deleted and their guests get a
          notice. You leave every request you joined. This cannot be undone.
        </p>
        <label>
          Type your username ({username}) to confirm
          <input name="confirm_username" autoCapitalize="none" spellCheck={false} required />
        </label>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" className="danger" disabled={pending}>
          Delete my account
        </button>
      </form>
    </details>
  );
}

"use client";

import { useActionState, useState } from "react";
import { setLinkEnabled } from "../actions";

export default function InviteLink({ dinnerId, url, enabled }) {
  const [copied, setCopied] = useState(false);
  const [state, formAction, pending] = useActionState(setLinkEnabled, {});

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked. The link is selectable in the field.
    }
  }

  return (
    <section className="card stack">
      <h2>Invite link</h2>
      {enabled ? (
        <>
          <p className="muted">Anyone with this link can join.</p>
          <div className="row">
            <input
              readOnly
              value={url}
              aria-label="Invite link"
              onFocus={(e) => e.target.select()}
              className="grow"
            />
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <p role="status">
          The link is off. New people cannot join. Guests who already joined keep access.
        </p>
      )}
      <form action={formAction}>
        <input type="hidden" name="dinner_id" value={dinnerId} />
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <button type="submit" disabled={pending}>
          {enabled ? "Turn the link off" : "Turn the link on"}
        </button>
      </form>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}

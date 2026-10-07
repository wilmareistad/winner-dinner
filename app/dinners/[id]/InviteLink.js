"use client";

import { useState } from "react";

export default function InviteLink({ url }) {
  const [copied, setCopied] = useState(false);

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
    </section>
  );
}

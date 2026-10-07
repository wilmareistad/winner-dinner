"use client";

import { useActionState } from "react";
import { formatShortDate } from "@/lib/dinners";
import { dismissNotice } from "./actions";

export default function NoticeList({ notices }) {
  if (notices.length === 0) return null;
  return (
    <section className="stack" aria-label="Notices">
      <h2>Notices</h2>
      <ul className="people">
        {notices.map((n) => (
          <Notice key={n.id} notice={n} />
        ))}
      </ul>
    </section>
  );
}

function Notice({ notice }) {
  const [state, formAction, pending] = useActionState(dismissNotice, {});
  return (
    <li className="notice stack">
      <p>{notice.text}</p>
      <form action={formAction} className="row">
        <input type="hidden" name="notice_id" value={notice.id} />
        <span className="muted grow">{formatShortDate(notice.created_at)}</span>
        <button type="submit" disabled={pending}>
          Dismiss
        </button>
      </form>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </li>
  );
}

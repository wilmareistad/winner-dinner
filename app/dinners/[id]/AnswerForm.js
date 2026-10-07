"use client";

import { useActionState } from "react";
import { answerInvitation } from "../actions";

const STATUS_TEXT = {
  invited: "You have not answered yet.",
  accepted: "You are coming.",
  declined: "You are not coming.",
};

export default function AnswerForm({ dinnerId, status, readOnly }) {
  const [state, formAction, pending] = useActionState(answerInvitation, {});

  return (
    <section className="card stack">
      <h2>Can you come?</h2>
      <p>{STATUS_TEXT[status]}</p>
      {!readOnly && (
        <form action={formAction} className="row">
          <input type="hidden" name="dinner_id" value={dinnerId} />
          <button
            type="submit"
            name="answer"
            value="accepted"
            className="primary"
            disabled={pending || status === "accepted"}
          >
            Yes, I am coming
          </button>
          <button
            type="submit"
            name="answer"
            value="declined"
            disabled={pending || status === "declined"}
          >
            No, I can&apos;t come
          </button>
        </form>
      )}
      {status === "accepted" && !readOnly && (
        <p className="muted">Answering no gives up the roles you hold.</p>
      )}
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}

"use client";

import { useActionState, useState } from "react";
import { signIn, signUp } from "./actions";

export default function AuthForm({ next }) {
  const [mode, setMode] = useState("login");
  const isLogin = mode === "login";

  return (
    <div className="card">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={isLogin}
          onClick={() => setMode("login")}
        >
          Log in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isLogin}
          onClick={() => setMode("signup")}
        >
          Sign up
        </button>
      </div>
      {/* Keyed so each mode gets its own action state. */}
      <CredentialsForm key={mode} isLogin={isLogin} next={next} />
    </div>
  );
}

function CredentialsForm({ isLogin, next }) {
  const [state, formAction, pending] = useActionState(isLogin ? signIn : signUp, {});

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="next" value={next} />
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.username ?? ""}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          required
        />
      </label>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="primary" disabled={pending}>
        {isLogin ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

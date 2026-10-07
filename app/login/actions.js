"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeUsername,
  safeNextPath,
  signInErrorMessage,
  signUpErrorMessage,
  usernameToEmail,
  validatePassword,
  validateUsername,
} from "@/lib/auth";

function readForm(formData) {
  return {
    username: normalizeUsername(formData.get("username")),
    password: String(formData.get("password") ?? ""),
    next: safeNextPath(formData.get("next")),
  };
}

export async function signIn(_prevState, formData) {
  const { username, password, next } = readForm(formData);
  // A malformed username can never match an account: same generic error.
  if (validateUsername(username) || !password) {
    return { error: signInErrorMessage(null), username };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) return { error: signInErrorMessage(error), username };

  redirect(next);
}

export async function signUp(_prevState, formData) {
  const { username, password, next } = readForm(formData);
  const invalid = validateUsername(username) ?? validatePassword(password);
  if (invalid) return { error: invalid, username };

  const supabase = await createClient();
  // The profile row (and the username) is created by a database trigger from the email.
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
  });
  if (error) return { error: signUpErrorMessage(error), username };
  // With email confirmation on, Supabase returns no session. Login is username-only,
  // so that is a configuration error, not something the user can fix.
  if (!data.session) return { error: signUpErrorMessage(null), username };

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

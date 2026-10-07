// End-to-end against the real Supabase Auth of the dev project. Creates real
// users and deletes them afterwards. Skipped while email confirmation is on,
// because username-only login requires it to be off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import {
  MESSAGES,
  signInErrorMessage,
  signUpErrorMessage,
  usernameToEmail,
} from "@/lib/auth";
import { connect } from "../db/helpers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function autoconfirmEnabled() {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  return (await res.json()).mailer_autoconfirm === true;
}

const enabled = await autoconfirmEnabled();
if (!enabled) {
  console.warn(
    "Skipping auth integration tests: turn off 'Confirm email' in Supabase " +
      "(Authentication > Sign In / Providers > Email)."
  );
}

function newClient() {
  return createClient(url, key, { auth: { persistSession: false } });
}

describe.skipIf(!enabled)("username login against Supabase Auth", () => {
  const username = `test_${randomBytes(4).toString("hex")}`;
  const password = "correct-horse-1";

  beforeAll(async () => {
    const { data, error } = await newClient().auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    if (error) throw error;
    expect(data.session).not.toBeNull();
  });

  afterAll(async () => {
    const db = await connect();
    try {
      await db.query("delete from auth.users where email = $1", [usernameToEmail(username)]);
    } finally {
      await db.end();
    }
  });

  it("sign-up creates a profile with the username", async () => {
    const client = newClient();
    await client.auth.signInWithPassword({ email: usernameToEmail(username), password });
    const { data } = await client.from("profiles").select("username");
    expect(data).toEqual([{ username }]);
  });

  it("logs in with username and password, and logs out", async () => {
    const client = newClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect((await client.auth.signOut()).error).toBeNull();
  });

  // Other capitalisation is covered by normalizeUsername (unit) and the citext index (db).
  it("duplicate username gives 'Username is not available'", async () => {
    const { error } = await newClient().auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    expect(signUpErrorMessage(error)).toBe(MESSAGES.usernameTaken);
  });

  it("wrong password and unknown username give the same generic error", async () => {
    const wrongPassword = await newClient().auth.signInWithPassword({
      email: usernameToEmail(username),
      password: "wrong-password-1",
    });
    const unknownUser = await newClient().auth.signInWithPassword({
      email: usernameToEmail(`${username}_x`),
      password,
    });
    expect(signInErrorMessage(wrongPassword.error)).toBe(MESSAGES.wrongCredentials);
    expect(signInErrorMessage(unknownUser.error)).toBe(MESSAGES.wrongCredentials);
  });

  it("sign-up with a real email address is rejected by the database", async () => {
    const { error } = await newClient().auth.signUp({
      email: `${username}@example.com`,
      password,
    });
    expect(error).not.toBeNull();
  });
});

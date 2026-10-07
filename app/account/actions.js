"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { MESSAGES, signInErrorMessage, usernameToEmail, validatePassword } from "@/lib/auth";
import { GENERIC_ERROR, dbErrorMessage, isUuid } from "@/lib/dinners";

// Every action works on the logged-in user only. None of them reads a user id
// from the form: the database takes the identity from the session (auth.uid()).
async function sessionClient() {
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);
  if (!userId) redirect("/login");
  return { supabase, userId };
}

function field(formData, name) {
  return String(formData.get(name) ?? "").trim();
}

async function ownUsername(supabase, userId) {
  const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  return data?.username ?? null;
}

export async function updateProfile(_prevState, formData) {
  const { supabase } = await sessionClient();
  const values = { display_name: field(formData, "display_name"), emoji: field(formData, "emoji") };

  const { error } = await supabase.rpc("update_profile", {
    p_display_name: values.display_name,
    p_emoji: values.emoji,
  });
  refresh();
  return error ? { error: dbErrorMessage(error), values } : { saved: true };
}

export async function dismissNotice(_prevState, formData) {
  const noticeId = field(formData, "notice_id");
  if (!isUuid(noticeId)) return { error: GENERIC_ERROR };
  const { supabase } = await sessionClient();

  const { error } = await supabase.rpc("dismiss_notice", { p_notice_id: noticeId });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
}

// The current password is checked first, so an open session alone cannot
// change it. That fresh login also satisfies Supabase's "secure password change".
export async function changePassword(_prevState, formData) {
  const { supabase, userId } = await sessionClient();
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");

  const invalid = validatePassword(next);
  if (invalid) return { error: invalid };

  const username = await ownUsername(supabase, userId);
  if (!username) return { error: GENERIC_ERROR };
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password: current,
  });
  if (signInError) {
    return {
      error:
        signInErrorMessage(signInError) === MESSAGES.rateLimited
          ? MESSAGES.rateLimited
          : "The current password is wrong.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error?.code === "same_password") return { error: "The new password must be different from the current one." };
  if (error) return { error: GENERIC_ERROR };
  return { saved: true };
}

// Asks for the username as confirmation. The database deletes only the caller.
export async function deleteAccount(_prevState, formData) {
  const { supabase, userId } = await sessionClient();
  const username = await ownUsername(supabase, userId);
  if (!username || field(formData, "confirm_username").toLowerCase() !== username) {
    return { error: "Type your username to confirm." };
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error: dbErrorMessage(error) };

  // The refresh tokens went with the user. Clear the cookies locally.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?deleted=1");
}

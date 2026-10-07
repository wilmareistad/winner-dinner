"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { DB_ERRORS, GENERIC_ERROR, dbErrorMessage, isUuid } from "@/lib/dinners";

// Actions are reachable by direct POST, so each one checks the session. All other
// rules (owner, status, slots, read-only) are checked by the database function.
async function sessionClient(returnTo) {
  const supabase = await createClient();
  if (!(await getCurrentUserId(supabase))) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return supabase;
}

function field(formData, name) {
  const value = String(formData.get(name) ?? "").trim();
  return value === "" ? null : value;
}

export async function createDinner(_prevState, formData) {
  const supabase = await sessionClient("/dinners/new");
  const values = Object.fromEntries(
    ["main_title", "main_description", "main_url", "date", "time", "short_description"].map(
      (name) => [name, field(formData, name)]
    )
  );

  const { data: dinnerId, error } = await supabase.rpc("create_dinner", {
    p_main_title: values.main_title,
    p_date: values.date,
    p_time: values.time,
    p_main_description: values.main_description,
    p_main_url: values.main_url,
    p_short_description: values.short_description,
  });
  if (error) return { error: dbErrorMessage(error), values };

  redirect(`/dinners/${dinnerId}`);
}

export async function answerInvitation(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  if (!isUuid(dinnerId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("set_answer", {
    p_dinner_id: dinnerId,
    p_answer: field(formData, "answer"),
  });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
}

export async function addFeature(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  if (!isUuid(dinnerId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("add_feature", {
    p_dinner_id: dinnerId,
    p_type: field(formData, "type"),
    p_slots: Number.parseInt(field(formData, "slots"), 10),
  });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
}

export async function toggleRole(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  const featureId = field(formData, "feature_id");
  if (!isUuid(dinnerId) || !isUuid(featureId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const claim = field(formData, "intent") === "claim";
  const { error } = await supabase.rpc(claim ? "claim_role" : "unclaim_role", {
    p_feature_id: featureId,
  });
  // A stale screen must only ever give a clear error, then the real state.
  refresh();
  if (!error) return {};
  // The claim button is only shown while a slot is free, so "full" means it
  // was taken after the page loaded (docs/ambiguity.md, Story A, E2).
  if (claim && error.code === DB_ERRORS.full) {
    return { error: "Someone just took the last slot." };
  }
  return { error: dbErrorMessage(error) };
}

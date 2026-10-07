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

const DINNER_FIELDS = [
  "main_title",
  "main_description",
  "main_url",
  "date",
  "time",
  "short_description",
  "invitation_summary",
];

function dinnerFields(formData) {
  return Object.fromEntries(DINNER_FIELDS.map((name) => [name, field(formData, name)]));
}

function dinnerArgs(values) {
  return {
    p_main_title: values.main_title,
    p_date: values.date,
    p_time: values.time,
    p_main_description: values.main_description,
    p_main_url: values.main_url,
    p_short_description: values.short_description,
    p_invitation_summary: values.invitation_summary,
  };
}

export async function createDinner(_prevState, formData) {
  const supabase = await sessionClient("/dinners/new");
  const values = dinnerFields(formData);

  const { data: dinnerId, error } = await supabase.rpc("create_dinner", dinnerArgs(values));
  if (error) return { error: dbErrorMessage(error), values };

  redirect(`/dinners/${dinnerId}`);
}

export async function updateDinner(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  if (!isUuid(dinnerId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);
  const values = dinnerFields(formData);

  const { error } = await supabase.rpc("update_dinner", {
    p_dinner_id: dinnerId,
    ...dinnerArgs(values),
  });
  refresh();
  return error ? { error: dbErrorMessage(error), values } : { saved: true };
}

export async function setLinkEnabled(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  if (!isUuid(dinnerId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("set_link_enabled", {
    p_dinner_id: dinnerId,
    p_enabled: field(formData, "enabled") === "true",
  });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
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

  const type = field(formData, "type");
  // Entertainment: a preset label, or the free text when "Other" is chosen.
  const label =
    field(formData, "label") === "other" ? field(formData, "label_other") : field(formData, "label");
  const { error } = await supabase.rpc("add_feature", {
    p_dinner_id: dinnerId,
    p_type: type,
    p_slots: Number.parseInt(field(formData, "slots"), 10),
    p_age_confirmed: field(formData, "age_confirmed") === "true",
    p_recipe_title: field(formData, "recipe_title"),
    p_recipe_url: field(formData, "recipe_url"),
    p_label: type === "entertainment" ? label : null,
  });
  refresh();
  return error ? { error: dbErrorMessage(error) } : { added: Date.now() };
}

export async function setSlots(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  const featureId = field(formData, "feature_id");
  if (!isUuid(dinnerId) || !isUuid(featureId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("set_slots", {
    p_feature_id: featureId,
    p_slots: Number.parseInt(field(formData, "slots"), 10),
  });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
}

// Without confirmation the database refuses to remove a feature someone holds
// (WD428). That also covers a stale screen that showed the feature as empty.
export async function removeFeature(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  const featureId = field(formData, "feature_id");
  if (!isUuid(dinnerId) || !isUuid(featureId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("remove_feature", {
    p_feature_id: featureId,
    p_confirm: field(formData, "confirm") === "true",
  });
  refresh();
  if (!error) return {};
  return {
    error: dbErrorMessage(error),
    needsConfirm: error.code === DB_ERRORS.confirmNeeded,
  };
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

export async function kickGuest(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  const userId = field(formData, "user_id");
  if (!isUuid(dinnerId) || !isUuid(userId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);

  const { error } = await supabase.rpc("kick_guest", { p_dinner_id: dinnerId, p_user_id: userId });
  refresh();
  return error ? { error: dbErrorMessage(error) } : {};
}

// Only finds kicked guests of this dinner (the database searches, not the client).
export async function readdGuest(_prevState, formData) {
  const dinnerId = field(formData, "dinner_id");
  if (!isUuid(dinnerId)) return { error: GENERIC_ERROR };
  const supabase = await sessionClient(`/dinners/${dinnerId}`);
  const username = field(formData, "username");

  const { error } = await supabase.rpc("readd_guest", { p_dinner_id: dinnerId, p_username: username });
  refresh();
  return error ? { error: dbErrorMessage(error), username } : { readded: username };
}

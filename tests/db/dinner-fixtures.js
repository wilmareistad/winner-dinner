// Builds dinners through the same functions the app uses. Every helper runs on
// the given client and leaves it in the admin role.
import { createAuthUser, rpcAs } from "./helpers";

// SQLSTATEs raised by the dinner functions (see the migration header).
export const ERR = {
  notLoggedIn: "WD000",
  notAllowed: "WD403",
  notFound: "WD404",
  onlyOnce: "WD405",
  alreadyHeld: "WD408",
  full: "WD409",
  linkNotValid: "WD410",
  blocked: "WD411",
  notAccepted: "WD412",
  invalid: "WD422",
  readOnly: "WD423",
  roleLimit: "WD429",
};

export const PERMISSION_DENIED = "42501";

// A date (YYYY-MM-DD) n days from today. +/- 2 days is safely future/past in Stockholm.
export function inDays(n) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

export function newDinner(db, ownerId) {
  return rpcAs(db, ownerId, "create_dinner", "Lasagna", inDays(7), "19:00");
}

export async function tokenOf(db, dinnerId) {
  const { rows } = await db.query("select invite_token from public.dinners where id = $1", [
    dinnerId,
  ]);
  return rows[0].invite_token;
}

// Creates a user who opened the link and, unless status is 'invited', answered.
// 'kicked' is set directly until kicking exists (milestone 3).
export async function addGuest(db, dinnerId, username, status = "accepted") {
  const id = await createAuthUser(db, username);
  await rpcAs(db, id, "join_by_token", await tokenOf(db, dinnerId));
  if (status === "accepted" || status === "declined") {
    await rpcAs(db, id, "set_answer", dinnerId, status);
  } else if (status === "kicked") {
    await db.query(
      "update public.participants set status = 'kicked' where dinner_id = $1 and user_id = $2",
      [dinnerId, id]
    );
  }
  return id;
}

export function addFeature(db, ownerId, dinnerId, type = "dessert", slots = 2) {
  return rpcAs(db, ownerId, "add_feature", dinnerId, type, slots);
}

// Moves the dinner time into the past, which makes the request read-only.
export async function makeReadOnly(db, dinnerId) {
  await db.query("update public.dinners set starts_at = now() - interval '1 hour' where id = $1", [
    dinnerId,
  ]);
}

export async function roleHolders(db, featureId) {
  const { rows } = await db.query("select user_id from public.roles where feature_id = $1", [
    featureId,
  ]);
  return rows.map((r) => r.user_id);
}

export async function roleCount(db, dinnerId, userId) {
  const { rows } = await db.query(
    "select count(*)::int as n from public.roles where dinner_id = $1 and user_id = $2",
    [dinnerId, userId]
  );
  return rows[0].n;
}

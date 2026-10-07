// Shared dinner helpers for pages and server actions. The rules themselves live
// in the database (supabase/migrations); this file only presents them.

export const TIME_ZONE = "Europe/Stockholm";

export const FEATURE_LABELS = {
  host: "Host",
  main_course: "Main course",
  appetizer: "Appetizer",
  dessert: "Dessert",
  snack: "Snack",
  alcohol: "Alcohol",
  soft_drinks: "Soft drinks",
  grocery_shopping: "Grocery shopping",
  cleanup: "Cleanup",
  entertainment: "Entertainment",
};

// Types User 1 can add in milestone 1. Host comes with the dinner. Alcohol waits
// for the age confirmation (milestone 2).
export const ADDABLE_FEATURE_TYPES = [
  "main_course",
  "appetizer",
  "dessert",
  "snack",
  "soft_drinks",
  "grocery_shopping",
  "cleanup",
  "entertainment",
];

export const MAX_ROLES = 2;

// SQLSTATEs raised by the dinner functions (see the migration header).
export const DB_ERRORS = {
  notLoggedIn: "WD000",
  full: "WD409",
  linkNotValid: "WD410",
  blocked: "WD411",
};

export const GENERIC_ERROR = "Something went wrong. Try again.";

// Our own database errors carry a message written for the user. Anything else
// is shown as a generic error so no internals leak.
export function dbErrorMessage(error) {
  if (typeof error?.code === "string" && error.code.startsWith("WD")) {
    return error.message;
  }
  return GENERIC_ERROR;
}

export function formatDinnerTime(startsAt) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

// Today's date in Stockholm as YYYY-MM-DD, for the date picker's minimum.
export function todayInStockholm(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export function isReadOnly(startsAt, now = new Date()) {
  return now >= new Date(startsAt);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function personLabel(person) {
  if (!person) return "Someone";
  return person.emoji ? `${person.emoji} ${person.username}` : person.username;
}

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

// Every type except Host, which comes with the dinner.
export const ADDABLE_FEATURE_TYPES = [
  "main_course",
  "appetizer",
  "dessert",
  "snack",
  "alcohol",
  "soft_drinks",
  "grocery_shopping",
  "cleanup",
  "entertainment",
];

// Extra courses: may be added several times and may have a recipe. All other
// types once per request (the database enforces both).
export const REPEATABLE_FEATURE_TYPES = ["appetizer", "dessert", "snack"];

export const ENTERTAINMENT_OPTIONS = ["Board games", "Console games", "Karaoke"];

// An icon per type, so colour is never the only signal. The colour itself is
// the CSS class feature--<type> in app/globals.css.
export const FEATURE_ICONS = {
  host: "🏠",
  main_course: "🍲",
  appetizer: "🥗",
  dessert: "🍰",
  snack: "🥨",
  alcohol: "🍷",
  soft_drinks: "🥤",
  grocery_shopping: "🛒",
  cleanup: "🧽",
  entertainment: "🎲",
};

// Same text as public.feature_name() in the database, which writes notices.
export function featureName({ type, label, recipe_title: recipeTitle }) {
  const base = FEATURE_LABELS[type] ?? type;
  return `${base}${label ? ` (${label})` : ""}${recipeTitle ? `: ${recipeTitle}` : ""}`;
}

export const MAX_ROLES = 2;

// SQLSTATEs raised by the dinner functions (see the migration header).
export const DB_ERRORS = {
  notLoggedIn: "WD000",
  full: "WD409",
  linkNotValid: "WD410",
  blocked: "WD411",
  confirmNeeded: "WD428",
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

// The dinner time as the date and time fields show it, in Stockholm.
export function stockholmDateTime(startsAt) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(startsAt))
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
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

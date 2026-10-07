// Username-only login on top of Supabase Auth (docs/ambiguity.md, section 4).
// The username is turned into a hidden email that is never shown or mailed.
// Change the domain here only: it is the single seam for the hidden-email approach.
export const HIDDEN_EMAIL_DOMAIN = "users.winnerdinner.app";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const PASSWORD_MIN_LENGTH = 8;

export const MESSAGES = {
  usernameInvalid:
    "Username must be 3 to 20 characters: letters, digits or underscore.",
  usernameTaken: "Username is not available.",
  passwordTooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  wrongCredentials: "Wrong username or password.",
  rateLimited: "Too many attempts. Wait a moment and try again.",
  signUpFailed: "Could not create the account. Try again.",
};

export function normalizeUsername(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export function validateUsername(username) {
  return USERNAME_PATTERN.test(username) ? null : MESSAGES.usernameInvalid;
}

export function validatePassword(password) {
  return String(password ?? "").length >= PASSWORD_MIN_LENGTH
    ? null
    : MESSAGES.passwordTooShort;
}

export function usernameToEmail(username) {
  return `${username}@${HIDDEN_EMAIL_DOMAIN}`;
}

function isRateLimited(error) {
  return error?.status === 429 || error?.code === "over_request_rate_limit";
}

export function signUpErrorMessage(error) {
  if (isRateLimited(error)) return MESSAGES.rateLimited;
  // Duplicate email (= duplicate username) or the unique index on profiles.username.
  if (
    error?.code === "user_already_exists" ||
    error?.code === "email_exists" ||
    /already registered|database error saving new user/i.test(error?.message ?? "")
  ) {
    return MESSAGES.usernameTaken;
  }
  return MESSAGES.signUpFailed;
}

// Never reveal whether the username or the password was wrong.
export function signInErrorMessage(error) {
  return isRateLimited(error) ? MESSAGES.rateLimited : MESSAGES.wrongCredentials;
}

// Only same-site relative paths, so "next" can never become an open redirect.
export function safeNextPath(next) {
  const path = String(next ?? "");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "/";
  }
  return path;
}

import { describe, expect, it } from "vitest";
import {
  HIDDEN_EMAIL_DOMAIN,
  MESSAGES,
  normalizeUsername,
  safeNextPath,
  signInErrorMessage,
  signUpErrorMessage,
  usernameToEmail,
  validatePassword,
  validateUsername,
} from "@/lib/auth";

describe("username rules", () => {
  it("normalizes to trimmed lowercase", () => {
    expect(normalizeUsername("  Anna_K ")).toBe("anna_k");
  });

  it.each(["abc", "anna_k", "a1b2c3", "x".repeat(20)])("accepts %s", (u) => {
    expect(validateUsername(u)).toBeNull();
  });

  it.each(["ab", "x".repeat(21), "anna k", "anna-k", "åsa", "Anna", ""])(
    "rejects %j",
    (u) => {
      expect(validateUsername(u)).toBe(MESSAGES.usernameInvalid);
    }
  );

  it("maps a username to the hidden email", () => {
    expect(usernameToEmail("anna_k")).toBe(`anna_k@${HIDDEN_EMAIL_DOMAIN}`);
  });
});

describe("password rules", () => {
  it("requires at least 8 characters", () => {
    expect(validatePassword("1234567")).toBe(MESSAGES.passwordTooShort);
    expect(validatePassword("12345678")).toBeNull();
  });
});

describe("error messages", () => {
  it("duplicate username gives 'Username is not available'", () => {
    expect(signUpErrorMessage({ code: "user_already_exists" })).toBe(
      "Username is not available."
    );
    expect(signUpErrorMessage({ message: "Database error saving new user" })).toBe(
      MESSAGES.usernameTaken
    );
  });

  it("wrong username and wrong password give the same message", () => {
    const wrongUser = signInErrorMessage({ code: "invalid_credentials", status: 400 });
    const wrongPassword = signInErrorMessage({ message: "anything else", status: 400 });
    expect(wrongUser).toBe(MESSAGES.wrongCredentials);
    expect(wrongPassword).toBe(wrongUser);
  });

  it("rate limits get their own message", () => {
    expect(signInErrorMessage({ status: 429 })).toBe(MESSAGES.rateLimited);
    expect(signUpErrorMessage({ code: "over_request_rate_limit" })).toBe(
      MESSAGES.rateLimited
    );
  });
});

describe("safeNextPath (no open redirect)", () => {
  it.each(["/", "/dinner/123", "/invite/abc?x=1"])("keeps %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("rejects %j", (p) => {
    expect(safeNextPath(p)).toBe("/");
  });
});

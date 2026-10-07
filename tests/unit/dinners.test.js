import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR,
  dbErrorMessage,
  featureName,
  formatDinnerTime,
  isReadOnly,
  isUuid,
  personLabel,
  stockholmDateTime,
  todayInStockholm,
} from "@/lib/dinners";

describe("dbErrorMessage", () => {
  it("shows our own database messages", () => {
    expect(dbErrorMessage({ code: "WD409", message: "This feature is full." })).toBe(
      "This feature is full."
    );
  });

  it("hides any other error behind a generic message", () => {
    expect(dbErrorMessage({ code: "23505", message: "duplicate key value violates ..." })).toBe(
      GENERIC_ERROR
    );
    expect(dbErrorMessage(null)).toBe(GENERIC_ERROR);
  });
});

describe("time in Stockholm", () => {
  it("formats the dinner time in Swedish time, summer and winter", () => {
    expect(formatDinnerTime("2099-07-01T17:00:00Z")).toContain("19:00");
    expect(formatDinnerTime("2099-01-15T18:00:00Z")).toContain("19:00");
  });

  it("gives today's date in Stockholm, also just after midnight there", () => {
    // 23:30 UTC on 1 July is 01:30 on 2 July in Stockholm.
    expect(todayInStockholm(new Date("2099-07-01T23:30:00Z"))).toBe("2099-07-02");
  });

  it("splits the dinner time into Stockholm date and time fields", () => {
    expect(stockholmDateTime("2099-07-01T17:00:00Z")).toEqual({ date: "2099-07-01", time: "19:00" });
    expect(stockholmDateTime("2099-01-15T23:30:00Z")).toEqual({ date: "2099-01-16", time: "00:30" });
  });

  it("is read-only from the dinner time on", () => {
    const startsAt = "2099-07-01T17:00:00Z";
    expect(isReadOnly(startsAt, new Date("2099-07-01T16:59:59Z"))).toBe(false);
    expect(isReadOnly(startsAt, new Date("2099-07-01T17:00:00Z"))).toBe(true);
  });
});

describe("small helpers", () => {
  it("accepts only uuids as ids", () => {
    expect(isUuid("6f1c1a52-1f0e-4c3e-9a51-0e8b8f0c2d11")).toBe(true);
    expect(isUuid("../login")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("labels a person with emoji and username", () => {
    expect(personLabel({ username: "anna_k", emoji: "🍝" })).toBe("🍝 anna_k");
    expect(personLabel({ username: "anna_k", emoji: null })).toBe("anna_k");
  });
});

describe("featureName", () => {
  // Must match public.feature_name() in the database, which writes notices.
  it("names a feature with its label or recipe title", () => {
    expect(featureName({ type: "grocery_shopping" })).toBe("Grocery shopping");
    expect(featureName({ type: "dessert", recipe_title: "Tiramisu" })).toBe("Dessert: Tiramisu");
    expect(featureName({ type: "entertainment", label: "Karaoke" })).toBe("Entertainment (Karaoke)");
  });
});

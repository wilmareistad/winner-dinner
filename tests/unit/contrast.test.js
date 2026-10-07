// "Text keeps sufficient contrast" (PLAN.md, milestone 7): every text colour
// on every background it is used on meets WCAG AA for normal text (4.5:1).
// Reads the colours from app/globals.css, so a palette change is checked too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const vars = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, hex]) => [name, hex])
);
const color = (name) => (name.startsWith("#") ? name : vars[name]);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text, background] as used in globals.css.
const PAIRS = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "violet-soft"], // badges, confirm boxes, selected tab
  ["text", "blue-soft"], // notices, "Full" badge, button hover
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "blue-soft"], // dates in notices
  ["muted", "violet-soft"],
  ["violet", "bg"], // links
  ["violet", "surface"],
  ["violet-dark", "bg"], // brand
  ["error", "surface"],
  ["error", "bg"],
  ["#ffffff", "violet"], // primary buttons
  ["#ffffff", "violet-dark"], // primary hover
  ["#ffffff", "error"], // danger buttons
];

describe("colour contrast (WCAG AA, 4.5:1)", () => {
  it("finds the palette in globals.css", () => {
    for (const name of ["text", "muted", "violet", "violet-soft", "blue-soft", "bg", "surface", "error"]) {
      expect(vars[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(PAIRS)("%s on %s", (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("the check itself is right (black on white is 21:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});

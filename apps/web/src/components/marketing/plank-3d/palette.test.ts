import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIGHTING } from "./palette";

// The 3D shelf replaces the CSS plank once it loads (desktop only), so its board is the same flat
// plank token in both themes: otherwise the shelf changes material mid-load.
const css = readFileSync(
  join(__dirname, "../../../styles/marketing.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const plankIn = (selector: string) => {
  const open = css.indexOf(`${selector} {`);
  const body = css.slice(open, css.indexOf("}", open));
  return /--mk-plank:\s*([^;]+);/.exec(body)?.[1]?.trim();
};

describe("3D shelf colour", () => {
  it("is the plank token in light and dark", () => {
    expect(plankIn(":root")).toBe("#e4c79a");
    expect(LIGHTING.light.shelfColor).toBe(plankIn(":root"));
    expect(LIGHTING.dark.shelfColor).toBe(plankIn(".dark"));
  });
});

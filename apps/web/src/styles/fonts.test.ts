import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SEC-65: the fonts are self-hosted (globals.css imports them from
// @fontsource). A <link>, @import or url() pointing back at Google Fonts would
// send every visitor's IP address to Google before any consent.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/;

describe("fonts", () => {
  it("are never loaded from Google Fonts", () => {
    const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(css|tsx?)$/.test(file))
      .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));
    expect(sources.length).toBeGreaterThan(100);

    const offenders = sources.filter((file) =>
      GOOGLE_FONTS.test(readFileSync(SRC + file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

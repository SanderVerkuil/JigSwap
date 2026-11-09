import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for UX-72: keyboard focus indicators are drawn in --ring at full alpha (2px), never at
// half alpha. A ring-ring/50 halo measured about 1.8:1 on the lavender grounds, below the 3:1
// that WCAG 1.4.11 asks for. The one exception is text fields (Input, Textarea, Select, and the
// tag field drawn like Input), whose full-alpha border-ring carries the indicator and the halo is
// only decoration.
const SRC = join(__dirname, "..");
const TEXT_FIELDS = new Set([
  "components/ui/input.tsx",
  "components/ui/textarea.tsx",
  "components/ui/select.tsx",
  "components/add-puzzle/tag-input.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(tsx?|css)$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe("focus indicators", () => {
  it("never use a half-alpha ring or outline", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      if (TEXT_FIELDS.has(file)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          /\b(ring|outline)-ring\/\d+/.test(line) ? [`${file}:${i + 1}`] : [],
        );
    });
    expect(
      offenders,
      "use ring-2 ring-ring (or the global :focus-visible outline) instead",
    ).toEqual([]);
  });

  // Night Primary (#1f7a63) is 2.5:1 on the night sheet, so a focus ring in it fails 1.4.11.
  // --ring is the focus colour in both themes. ring-primary-text stays legal.
  it("never draw a focus ring in the primary fill colour", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      return readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          /\b(focus|focus-visible|focus-within):ring-(primary|jigsaw-primary)(?![\w-])/.test(
            line,
          )
            ? [`${file}:${i + 1}`]
            : [],
        );
    });
    expect(
      offenders,
      "use focus-visible:ring-2 focus-visible:ring-ring instead",
    ).toEqual([]);
  });

  // A menu, select or palette row marked only by the accent tint is 1.15:1 against the menu: the
  // row the keyboard is on carries a --ring outline as well.
  it("outline the keyboard row in menus, not just tint it", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      return readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          /(^|\s|")(focus|data-\[selected=true\]):bg-accent\b/.test(line) &&
          !/:outline-ring\b/.test(line)
            ? [`${file}:${i + 1}`]
            : [],
        );
    });
    expect(
      offenders,
      "add focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring",
    ).toEqual([]);
  });
});

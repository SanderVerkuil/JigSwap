import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for UX-72: keyboard focus indicators are drawn in --ring at full alpha (2px), never at
// half alpha. A ring-ring/50 halo measured about 1.8:1 on the lavender grounds, below the 3:1
// that WCAG 1.4.11 asks for. The one exception is text fields (Input, Textarea, Select), whose
// full-alpha focus-visible:border-ring carries the indicator and the halo is only decoration.
const SRC = join(__dirname, "..");
const TEXT_FIELDS = new Set([
  "components/ui/input.tsx",
  "components/ui/textarea.tsx",
  "components/ui/select.tsx",
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
});

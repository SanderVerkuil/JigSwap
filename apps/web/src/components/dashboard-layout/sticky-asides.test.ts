import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for UX-33: from md up the shell's glass page head sticks over the scroll region, so a sticky
// aside or panel has to sit below it (--app-sticky-top), not a fixed distance from the top, or its
// first rows slide under the head as the page scrolls. The public pages have no shell and keep
// their own offset under the marketing header.
const SRC = join(__dirname, "..", "..");
const OUTSIDE_THE_SHELL = /^components\/marketing\//;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx$/.test(entry.name)) return [];
    if (/\.test\.tsx$/.test(entry.name)) return [];
    return [path];
  });
}

describe("sticky asides under the page head", () => {
  it("stick below it through --app-sticky-top, never at a fixed offset", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      if (OUTSIDE_THE_SHELL.test(file)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /<aside\b/.test(line) &&
            /\bsticky\b/.test(line) &&
            !/top-\[calc\(var\(--app-sticky-top/.test(line),
        )
        .map((line) => `${file}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});

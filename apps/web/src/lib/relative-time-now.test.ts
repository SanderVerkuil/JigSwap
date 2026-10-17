import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard: every use-intl `.relativeTime(date, now)` call must pass `now`.
// Without it use-intl reads the environment clock, reports
// ENVIRONMENT_FALLBACK, and SSR/hydration can disagree. Prefer the
// useRelativeTime() hook, which supplies a ticking `now`.
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    if (entry.name === "routeTree.gen.ts") return [];
    return [path];
  });
}

// Returns the number of top-level arguments of the call whose "(" is at
// `open`, tracking nested brackets so `f(a, b)` inside an argument is ignored.
function countArgs(source: string, open: number): number {
  let depth = 0;
  let args = 0;
  let sawToken = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return sawToken ? args + 1 : args;
    } else if (ch === "," && depth === 1) {
      // A trailing comma before ")" does not start another argument.
      if (/^\s*\)/.test(source.slice(i + 1))) continue;
      args++;
      continue;
    }
    if (depth >= 1 && !/\s/.test(ch)) sawToken = true;
  }
  throw new Error(`Unbalanced call at offset ${open}`);
}

function singleArgRelativeTimeCalls(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(/\.relativeTime\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    if (countArgs(source, open) < 2) {
      lines.push(source.slice(0, match.index).split("\n").length);
    }
  }
  return lines;
}

describe("relativeTime calls pass an explicit now", () => {
  it("counts top-level arguments", () => {
    expect(countArgs("(a)", 0)).toBe(1);
    expect(countArgs("(new Date(x.y))", 0)).toBe(1);
    expect(countArgs("(new Date(x, y),\n  now,\n)", 0)).toBe(2);
    expect(countArgs("([a, b])", 0)).toBe(1);
    expect(countArgs("()", 0)).toBe(0);
  });

  it("flags a single-argument call", () => {
    expect(singleArgRelativeTimeCalls("x\nformat.relativeTime(d);")).toEqual([
      2,
    ]);
    expect(singleArgRelativeTimeCalls("format.relativeTime(d, now);")).toEqual(
      [],
    );
  });

  it("has no single-argument calls in apps/web/src", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      singleArgRelativeTimeCalls(readFileSync(file, "utf8")).map(
        (line) => `${relative(SRC, file)}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

// Guard: a copy's effective household permission is resolved ONLY by the domain's
// resolveHouseholdCopyPermission (explicit value, else household default, else "manage"). No reader
// may keep its own `householdPermission ?? …` fallback, which would silently ignore the default.

const roots = [
  join(__dirname),
  join(__dirname, "../../domain/src"),
  join(__dirname, "../../../apps/web/src"),
];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "_generated") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)
      ? [path]
      : [];
  });

describe("household permission resolution", () => {
  test("no source falls back on householdPermission outside the domain helper", () => {
    const offenders = roots
      .flatMap(sources)
      .filter((path) =>
        /householdPermission\s*(\?\?|\|\|)/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(join(__dirname, "../../.."), path));
    expect(offenders).toEqual([]);
  });
});

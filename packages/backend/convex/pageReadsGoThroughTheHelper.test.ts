import { describe, expect, test } from "vitest";

// A page the hooks may pin has to be read through paginateBounded (lib/pageSize): it bounds the read,
// and it keeps a split from losing the rows past where the read stopped. A read that clamps by hand
// and forgets the second half works in every test whose filter is dense, and loses rows in production
// once a filter is sparse. So the clamp has one caller.
const sources = import.meta.glob(
  ["./**/*.ts", "!./**/*.test.ts", "!./_generated/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// Pages through two index ranges with its own cursor encoding, and no client pins it: the web reads
// it with Convex's own hook, which only pins the halves of a split, and it answers no split to act on.
const HAND_CLAMPED = ["./social/listProfileCompletions.ts"];

describe("every pinned paged read goes through paginateBounded", () => {
  test("nothing else clamps a page by hand", () => {
    const callers = Object.entries(sources)
      .filter(([, source]) =>
        /\b(clampPaginationOpts|keepPinnedEnd)\(/.test(source),
      )
      .map(([path]) => path);
    expect(callers.sort()).toEqual(
      ["./lib/pageSize.ts", ...HAND_CLAMPED].sort(),
    );
  });
});

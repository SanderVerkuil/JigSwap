import { describe, expect, test } from "vitest";
import { clampLimit, clampOffset, clampPaginationOpts } from "./lib/pageSize";

describe("clampLimit", () => {
  const bounds = { fallback: 20, max: 50 };

  test("a missing or non-finite size falls back to the default", () => {
    expect(clampLimit(undefined, bounds)).toBe(20);
    expect(clampLimit(Number.NaN, bounds)).toBe(20);
    expect(clampLimit(Number.POSITIVE_INFINITY, bounds)).toBe(20);
    expect(clampLimit(Number.NEGATIVE_INFINITY, bounds)).toBe(20);
  });

  test("a size below one becomes one", () => {
    expect(clampLimit(0, bounds)).toBe(1);
    expect(clampLimit(-5, bounds)).toBe(1);
    expect(clampLimit(0.5, bounds)).toBe(1);
  });

  test("a fractional size is floored", () => {
    expect(clampLimit(2.7, bounds)).toBe(2);
  });

  test("a size above the maximum becomes the maximum", () => {
    expect(clampLimit(1e9, bounds)).toBe(50);
    expect(clampLimit(51, bounds)).toBe(50);
  });

  test("a size within the bounds is kept", () => {
    expect(clampLimit(1, bounds)).toBe(1);
    expect(clampLimit(12, bounds)).toBe(12);
    expect(clampLimit(50, bounds)).toBe(50);
  });
});

describe("clampOffset", () => {
  test("a missing, non-finite or negative offset starts at zero", () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampOffset(-3)).toBe(0);
  });

  test("a fractional offset is floored; a valid one is kept", () => {
    expect(clampOffset(2.7)).toBe(2);
    expect(clampOffset(40)).toBe(40);
  });
});

describe("clampPaginationOpts", () => {
  test("clamps numItems into [1, max] and keeps every other option", () => {
    const opts = {
      numItems: 1e9,
      cursor: "abc",
      endCursor: "xyz",
      maximumRowsRead: 500,
      id: 7,
    };
    expect(clampPaginationOpts(opts, 50)).toEqual({ ...opts, numItems: 50 });
  });

  test("a non-finite numItems asks for one full page; a small one is kept", () => {
    expect(
      clampPaginationOpts({ numItems: Number.NaN, cursor: null }, 50).numItems,
    ).toBe(50);
    expect(
      clampPaginationOpts({ numItems: 0, cursor: null }, 50).numItems,
    ).toBe(1);
    expect(
      clampPaginationOpts({ numItems: 12, cursor: null }, 50).numItems,
    ).toBe(12);
  });
});

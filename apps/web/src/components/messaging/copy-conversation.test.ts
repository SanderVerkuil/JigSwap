import { describe, expect, it } from "vitest";
import {
  copyMessageRoute,
  isOwnCopy,
  parseCopyMessageSearch,
} from "./copy-conversation";

describe("parseCopyMessageSearch", () => {
  it("keeps a non-empty copy id", () => {
    expect(parseCopyMessageSearch({ copy: "k57abc" })).toEqual({
      copy: "k57abc",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCopyMessageSearch({ copy: "  k57abc " })).toEqual({
      copy: "k57abc",
    });
  });

  it("drops a missing, blank, or non-string copy", () => {
    expect(parseCopyMessageSearch({})).toEqual({});
    expect(parseCopyMessageSearch({ copy: "   " })).toEqual({});
    expect(parseCopyMessageSearch({ copy: 42 })).toEqual({});
    expect(parseCopyMessageSearch({ copy: ["a"] })).toEqual({});
  });

  it("ignores unrelated params (the owner is never taken from the URL)", () => {
    expect(parseCopyMessageSearch({ copy: "c1", to: "someone" })).toEqual({
      copy: "c1",
    });
  });
});

describe("copyMessageRoute", () => {
  it("targets /messages/new with only the copy id", () => {
    expect(copyMessageRoute("c1")).toEqual({
      to: "/messages/new",
      search: { copy: "c1" },
    });
  });

  it("round-trips through the search parser", () => {
    expect(parseCopyMessageSearch(copyMessageRoute("c1").search)).toEqual({
      copy: "c1",
    });
  });
});

describe("isOwnCopy", () => {
  it("is true only when the viewer owns the copy", () => {
    expect(isOwnCopy("u1", "u1")).toBe(true);
    expect(isOwnCopy("u1", "u2")).toBe(false);
  });

  it("is false while the viewer is unknown", () => {
    expect(isOwnCopy("u1", undefined)).toBe(false);
  });
});

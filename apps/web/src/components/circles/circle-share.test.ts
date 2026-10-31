import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  chunked,
  circleHiddenReason,
  circleShareErrorKey,
  stagedChanges,
  toggleStaged,
} from "./circle-share";

const OPEN = { forTrade: false, forSale: false, forLend: true };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const lookup = (messages: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );

describe("circleShareErrorKey", () => {
  it("names each refusal the share mutations explain, and is translated", () => {
    for (const code of [
      "CopyNotFound",
      "CircleNotFound",
      "CannotShareCopy",
      "BatchTooLarge",
    ]) {
      const key = circleShareErrorKey(new ConvexError({ code, message: "x" }));
      expect(key).toBe(`shareErrors.${code}`);
      expect(typeof lookup(en.circles, key)).toBe("string");
      expect(typeof lookup(nl.circles, key)).toBe("string");
    }
  });

  it("falls back to the generic message for anything else", () => {
    expect(circleShareErrorKey(new Error("offline"))).toBe(
      "shareErrors.generic",
    );
    expect(
      circleShareErrorKey(new ConvexError({ code: "Weird", message: "x" })),
    ).toBe("shareErrors.generic");
    expect(typeof lookup(nl.circles, "shareErrors.generic")).toBe("string");
  });
});

describe("circleHiddenReason", () => {
  it("is null for an offered copy members will see", () => {
    expect(circleHiddenReason({ availability: OPEN })).toBeNull();
    expect(
      circleHiddenReason({ availability: OPEN, visibility: "visible" }),
    ).toBeNull();
  });

  it("flags a copy that isn't offered, and a private one first", () => {
    expect(circleHiddenReason({ availability: CLOSED })).toBe("notOffered");
    expect(
      circleHiddenReason({ availability: CLOSED, visibility: "private" }),
    ).toBe("private");
  });
});

describe("staged shares", () => {
  it("stages a tick that differs from the server and drops one that goes back", () => {
    let staged = toggleStaged(new Map(), "a", false);
    staged = toggleStaged(staged, "b", true);
    expect(stagedChanges(staged)).toEqual({ adds: ["a"], removes: ["b"] });

    staged = toggleStaged(staged, "a", false);
    staged = toggleStaged(staged, "b", true);
    expect(staged.size).toBe(0);
  });

  it("chunks a large selection to the server's batch size", () => {
    expect(chunked(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(chunked([], 2)).toEqual([]);
  });
});

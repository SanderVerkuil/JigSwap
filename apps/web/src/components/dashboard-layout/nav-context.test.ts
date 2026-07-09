import { describe, expect, it } from "vitest";
import { parseNavContext } from "./nav-context";

describe("parseNavContext", () => {
  it("parses a collection context", () => {
    expect(parseNavContext("collection:abc123")).toEqual({
      kind: "collection",
      id: "abc123",
    });
  });
  it.each(["", "collection:", "puzzle:x", "collection", undefined])(
    "returns null for %s",
    (value) => {
      expect(parseNavContext(value)).toBeNull();
    },
  );
});

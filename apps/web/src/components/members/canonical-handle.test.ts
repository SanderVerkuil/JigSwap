import { describe, expect, it } from "vitest";
import { canonicalHandleOf } from "./canonical-handle";

describe("canonicalHandleOf", () => {
  it("uses the server's canonical handle", () => {
    expect(
      canonicalHandleOf(
        { memberId: "u_bob", slug: "bobby", handle: "bob" },
        "u_bob",
      ),
    ).toBe("bob");
  });

  describe("a backend that predates `handle` (deploy skew)", () => {
    it("falls back to the slug", () => {
      expect(canonicalHandleOf({ memberId: "u_bob", slug: "bobby" })).toBe(
        "bobby",
      );
      expect(
        canonicalHandleOf({ memberId: "u_bob", slug: "bobby" }, "bob"),
      ).toBe("bobby");
    });

    it("without a slug, stays on the handle the page was opened with", () => {
      // The server resolved "bob" to this member, so a username URL doesn't jump to the bare id.
      expect(canonicalHandleOf({ memberId: "u_bob" }, "bob")).toBe("bob");
      expect(canonicalHandleOf({ memberId: "u_bob" }, "u_bob")).toBe("u_bob");
    });
  });

  it("falls back to the id, never the username", () => {
    // Another member may hold "bob" as a slug (SEC-07).
    const hero = { memberId: "u_bob", username: "bob" };
    expect(canonicalHandleOf(hero)).toBe("u_bob");
  });
});

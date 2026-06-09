import { describe, expect, it } from "vitest";
import { fromId, Id, toId } from "./identifier";

describe("branded identifiers", () => {
  it("toId brands a raw string and fromId recovers the exact same string", () => {
    const raw = "member-123";
    const id = toId<"MemberId">(raw);
    // fromId must return the underlying value, not undefined (the branding is type-only).
    expect(fromId(id)).toBe(raw);
  });

  it("round-trips an empty string unchanged", () => {
    const id: Id<"X"> = toId<"X">("");
    expect(fromId(id)).toBe("");
  });
});

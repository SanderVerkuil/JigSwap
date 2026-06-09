import { describe, expect, it } from "vitest";
import { CatalogError } from "./errors";

// Each factory pairs a stable discriminant `code` with a human message. Asserting both pins
// the message construction (interpolated values must actually appear) so message mutations die.
describe("CatalogError factories", () => {
  it("emptyTitle", () => {
    const e = CatalogError.emptyTitle();
    expect(e.code).toBe("EmptyTitle");
    expect(e.name).toBe("CatalogError");
    expect(e.message).toBe("A puzzle definition requires a non-empty title");
  });

  it("invalidPieceCount interpolates the offending value", () => {
    const e = CatalogError.invalidPieceCount(-3);
    expect(e.code).toBe("InvalidPieceCount");
    expect(e.message).toBe("Piece count must be a positive integer, got -3");
  });

  it("invalidBarcode interpolates kind and detail", () => {
    const e = CatalogError.invalidBarcode("EAN", "must be 13 digits");
    expect(e.code).toBe("InvalidBarcode");
    expect(e.message).toBe("Invalid EAN: must be 13 digits");
  });

  it("illegalApprovalTransition names both states", () => {
    const e = CatalogError.illegalApprovalTransition("approved", "pending");
    expect(e.code).toBe("IllegalApprovalTransition");
    expect(e.message).toBe("Cannot transition approval from approved to pending");
  });

  it("emptyCategoryName", () => {
    const e = CatalogError.emptyCategoryName();
    expect(e.code).toBe("EmptyCategoryName");
    expect(e.message).toBe("A catalog category requires a non-empty name in each locale");
  });
});
